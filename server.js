import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Store connected extension
let extensionSocket = null;
let pendingCommands = new Map();
let commandId = 0;

// Load provider scripts
function loadScript(provider, action) {
  const scriptPath = join(__dirname, 'scripts', provider, `${action}.js`);
  try {
    return readFileSync(scriptPath, 'utf-8');
  } catch (err) {
    throw new Error(`Script not found: ${provider}/${action}`);
  }
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('[Server] Extension connected');
  extensionSocket = ws;
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      console.log('[Server] Received from extension:', message);
      
      // Handle command results
      if (message.type === 'result') {
        const pending = pendingCommands.get(message.commandId);
        if (pending) {
          pending.resolve(message.result);
          pendingCommands.delete(message.commandId);
        }
      }
    } catch (err) {
      console.error('[Server] Error parsing message:', err);
    }
  });
  
  ws.on('close', () => {
    console.log('[Server] Extension disconnected');
    extensionSocket = null;
  });
});

// Send command to extension with script code
async function sendCommandToExtension(action, params) {
  if (!extensionSocket || extensionSocket.readyState !== 1) {
    throw new Error('Extension not connected');
  }
  
  const id = ++commandId;
  
  // Load the script code from server
  const scriptCode = loadScript('deepseek', action);
  console.log(`[Server] Loaded script: deepseek/${action}.js (${scriptCode.length} bytes)`);
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingCommands.delete(id);
      reject(new Error('Command timeout'));
    }, 180000); // 3 minutes timeout
    
    pendingCommands.set(id, { resolve, reject, timeout });
    
    const command = {
      type: 'command',
      commandId: id,
      action,
      code: scriptCode, // ← Send the actual JavaScript code
      params
    };
    
    console.log('[Server] Sending command to extension:', { action, params });
    extensionSocket.send(JSON.stringify(command));
  });
}

// API endpoint to send prompt
app.post('/api/prompt', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }
    
    console.log('[API] Received prompt:', message);
    
    // Send to extension with script code
    const result = await sendCommandToExtension('prompt', { message });
    
    res.json({ success: true, result });
  } catch (err) {
    console.error('[API] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// API endpoint for newchat
app.post('/api/newchat', async (req, res) => {
  try {
    const result = await sendCommandToExtension('newchat', {});
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API endpoint to check connection status
app.get('/api/status', (req, res) => {
  res.json({
    connected: extensionSocket && extensionSocket.readyState === 1
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT}`);
});