(async () => {
  const { tempMessage } = await chrome.storage.local.get('tempMessage');
  if (!tempMessage) throw new Error('No message to send');
  
  const ta = document.querySelector('textarea');
  if (!ta) throw new Error('Textarea not found');
  
  // Type message
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  setter.call(ta, tempMessage);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  
  // Trigger Enter key with FULL properties (React/Vue frameworks require keyCode/which)
  const enterEvent = (type) => new KeyboardEvent(type, {
    key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
  });
  ta.dispatchEvent(enterEvent('keydown'));
  ta.dispatchEvent(enterEvent('keypress'));
  ta.dispatchEvent(enterEvent('keyup'));
  
  // Fallback: try to click the send button if it exists and is enabled
  setTimeout(() => {
    const buttons = document.querySelectorAll('button');
    for (let btn of buttons) {
      if (!btn.disabled && btn.querySelector('svg') && btn.getBoundingClientRect().top > ta.getBoundingClientRect().top) {
        btn.click();
        break;
      }
    }
  }, 200);
  
  // Wait for response
  let lastLength = 0, stableCount = 0;
  const maxWait = 120000; // 2 minutes max
  const startTime = Date.now();
  
  const getText = () => {
    const nodes = document.querySelectorAll('[class*="message"], [class*="assistant"]');
    return nodes.length ? nodes[nodes.length-1].innerText : '';
  };
  
  const initial = getText();
  
  while (Date.now() - startTime < maxWait) {
    await new Promise(r => setTimeout(r, 1000)); // Check every 1 second
    
    const current = getText();
    
    // Check if it looks like a complete JSON response (balanced braces)
    const trimmed = current.trim();
    const openBraces = (trimmed.match(/{/g) || []).length;
    const closeBraces = (trimmed.match(/}/g) || []).length;
    const isLikelyComplete = trimmed.endsWith('}') && openBraces === closeBraces && openBraces > 0 && current.length > 50;
                             
    if (current !== initial && current.length > 0) {
      if (isLikelyComplete) {
        // If it looks like complete JSON, wait 2s to ensure no trailing buttons are added
        await new Promise(r => setTimeout(r, 2000));
        const finalCheck = getText();
        if (finalCheck.trim().endsWith('}')) {
          await chrome.storage.local.set({ tempOutput: finalCheck });
          break;
        }
      } else {
        // If not complete JSON, use stable count logic
        if (current.length === lastLength) {
          stableCount++;
          if (stableCount >= 5) { // 5 seconds stable
            await chrome.storage.local.set({ tempOutput: current });
            break;
          }
        } else {
          stableCount = 0;
        }
      }
    }
    lastLength = current.length;
  }
  
  if (Date.now() - startTime >= maxWait) {
    const finalText = getText();
    if (finalText && finalText !== initial) {
      await chrome.storage.local.set({ tempOutput: finalText });
    } else {
      await chrome.storage.local.set({ tempOutput: 'TIMEOUT_ERROR' });
    }
  }
})();