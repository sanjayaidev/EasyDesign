import express from 'express';
import { sql } from '../server-db.js';
import { authenticate } from './auth.js';

const router = express.Router();

// POST /api/data/plans
router.post('/plans', authenticate, async (req, res) => {
  console.log(`[Server API] POST /plans - User ID: ${req.user.userId}, Plan ID: ${req.body.planId}`);
  try {
    const { month, year, posts, planId } = req.body;
    const userId = req.user.userId;

    console.log(`[Server API] POST /plans - Inserting plan and ${posts?.length || 0} posts...`);
    await sql`INSERT INTO plans (id, user_id, month, year, status) 
              VALUES (${planId}, ${userId}, ${month}, ${year}, 'in_progress') 
              ON CONFLICT (id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`;

    for (const post of posts) {
      const postId = `post_${planId}_day${post.day}`;
      const metadata = JSON.stringify({
        title: post.title, caption: post.caption, hashtags: post.hashtags, image_prompt: post.image_prompt
      });

      await sql`
        INSERT INTO daily_posts (id, plan_id, day, type, metadata, status)
        VALUES (${postId}, ${planId}, ${post.day}, ${post.type || 'single'}, ${metadata}::jsonb, ${post.status || 'pending'})
        ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type, metadata = EXCLUDED.metadata, status = EXCLUDED.status, updated_at = CURRENT_TIMESTAMP
      `;

      const slides = post.slides || [{ role: 'single', designSpec: post.designSpec, generatedAsset: post.images?.[0] }];
      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];
        const slideId = `slide_${postId}_idx${i}`;
        await sql`
          INSERT INTO post_slides (id, post_id, slide_index, role, design_spec, generated_asset, status)
          VALUES (${slideId}, ${postId}, ${i}, ${slide.role || 'single'}, ${JSON.stringify(slide.designSpec || slide.design_spec)}::jsonb, ${slide.generatedAsset || slide.generated_asset}, ${slide.status || 'pending'})
          ON CONFLICT (id) DO UPDATE SET design_spec = EXCLUDED.design_spec, generated_asset = EXCLUDED.generated_asset, status = EXCLUDED.status, updated_at = CURRENT_TIMESTAMP
        `;
      }
    }
    console.log(`[Server API] POST /plans - SUCCESS for User ID: ${userId}`);
    res.json({ success: true, message: 'Plan saved' });
  } catch (err) {
    console.error(`[Server API] POST /plans ERROR - User ID: ${req.user.userId}`, err);
    res.status(500).json({ success: false, error: 'Failed to save plan' });
  }
});

// GET /api/data/plans
router.get('/plans', authenticate, async (req, res) => {
  console.log(`[Server API] GET /plans - User ID: ${req.user.userId}`);
  try {
    const rows = await sql`
      SELECT p.id, p.month, p.year, p.status, COUNT(dp.id) as post_count 
      FROM plans p LEFT JOIN daily_posts dp ON p.id = dp.plan_id 
      WHERE p.user_id = ${req.user.userId}
      GROUP BY p.id ORDER BY p.year DESC, p.month DESC
    `;
    console.log(`[Server API] GET /plans - Found ${rows.length} plans for User ID: ${req.user.userId}`);
    
    const plans = {};
    for (const row of rows) {
      plans[row.id] = { 
        id: row.id, 
        month: row.month, 
        year: row.year, 
        status: row.status, 
        post_count: parseInt(row.post_count) 
      };
    }
    res.json({ success: true, result: plans });
  } catch (err) {
    console.error(`[Server API] GET /plans ERROR - User ID: ${req.user.userId}`, err);
    res.status(500).json({ success: false, error: 'Failed to load plans' });
  }
});

// GET /api/data/plans/:planId
router.get('/plans/:planId', authenticate, async (req, res) => {
  console.log(`[Server API] GET /plans/:planId - User ID: ${req.user.userId}, Plan ID: ${req.params.planId}`);
  try {
    const planCheck = await sql`SELECT id FROM plans WHERE id = ${req.params.planId} AND user_id = ${req.user.userId}`;
    if (planCheck.length === 0) {
      console.log(`[Server API] GET /plans/:planId - UNAUTHORIZED: Plan not found or wrong user`);
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    const postsRows = await sql`SELECT id, day, type, metadata, status FROM daily_posts WHERE plan_id = ${req.params.planId} ORDER BY day ASC`;
    console.log(`[Server API] GET /plans/:planId - Found ${postsRows.length} posts`);
    
    const posts = [];
    for (const row of postsRows) {
      const slidesRows = await sql`SELECT slide_index, role, design_spec, generated_asset, status FROM post_slides WHERE post_id = ${row.id} ORDER BY slide_index ASC`;
      posts.push({
        postId: row.id, day: row.day, type: row.type, status: row.status,
        title: row.metadata?.title || '', caption: row.metadata?.caption || '',
        hashtags: row.metadata?.hashtags || [], image_prompt: row.metadata?.image_prompt || '',
        slides: slidesRows.map(s => ({ role: s.role, designSpec: s.design_spec, generatedAsset: s.generated_asset, status: s.status })),
        images: slidesRows.map(s => s.generated_asset).filter(Boolean)
      });
    }
    console.log(`[Server API] GET /plans/:planId - SUCCESS`);
    res.json({ success: true, result: posts });
  } catch (err) {
    console.error(`[Server API] GET /plans/:planId ERROR - User ID: ${req.user.userId}, Plan ID: ${req.params.planId}`, err);
    res.status(500).json({ success: false, error: 'Failed to load plan details' });
  }
});

// DELETE /api/data/plans/:planId
router.delete('/plans/:planId', authenticate, async (req, res) => {
  console.log(`[Server API] DELETE /plans/:planId - User ID: ${req.user.userId}, Plan ID: ${req.params.planId}`);
  try {
    const planCheck = await sql`SELECT id FROM plans WHERE id = ${req.params.planId} AND user_id = ${req.user.userId}`;
    if (planCheck.length === 0) return res.status(403).json({ success: false, error: 'Unauthorized' });

    await sql`DELETE FROM post_slides WHERE post_id IN (SELECT id FROM daily_posts WHERE plan_id = ${req.params.planId})`;
    await sql`DELETE FROM daily_posts WHERE plan_id = ${req.params.planId}`;
    await sql`DELETE FROM ai_images WHERE "planId" = ${req.params.planId} AND user_id = ${req.user.userId}`;
    await sql`DELETE FROM plans WHERE id = ${req.params.planId}`;
    
    console.log(`[Server API] DELETE /plans/:planId - SUCCESS`);
    res.json({ success: true, message: 'Plan deleted' });
  } catch (err) {
    console.error(`[Server API] DELETE /plans/:planId ERROR - User ID: ${req.user.userId}`, err);
    res.status(500).json({ success: false, error: 'Failed to delete plan' });
  }
});

// DELETE /api/data/posts/:postId
router.delete('/posts/:postId', authenticate, async (req, res) => {
  console.log(`[Server API] DELETE /posts/:postId - User ID: ${req.user.userId}, Post ID: ${req.params.postId}`);
  try {
    const postCheck = await sql`SELECT dp.id FROM daily_posts dp JOIN plans p ON dp.plan_id = p.id WHERE dp.id = ${req.params.postId} AND p.user_id = ${req.user.userId}`;
    if (postCheck.length === 0) return res.status(403).json({ success: false, error: 'Unauthorized' });
    
    await sql`DELETE FROM post_slides WHERE post_id = ${req.params.postId}`;
    await sql`DELETE FROM daily_posts WHERE id = ${req.params.postId}`;
    
    console.log(`[Server API] DELETE /posts/:postId - SUCCESS`);
    res.json({ success: true, message: 'Post deleted' });
  } catch (err) {
    console.error(`[Server API] DELETE /posts/:postId ERROR - User ID: ${req.user.userId}`, err);
    res.status(500).json({ success: false, error: 'Failed to delete post' });
  }
});

// POST /api/data/ai-images
router.post('/ai-images', authenticate, async (req, res) => {
  console.log(`[Server API] POST /ai-images - User ID: ${req.user.userId}, Plan ID: ${req.body.planId}`);
  try {
    const { planId, day, slideIndex, type, imageUrl, prompt, aspectRatio, sourceJson } = req.body;
    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`;
    const timestamp = Date.now();
    
    await sql`INSERT INTO ai_images (id, user_id, "planId", day, "slideIndex", type, "imageUrl", prompt, "aspectRatio", "sourceJson", "createdAt", "updatedAt") 
              VALUES (${id}, ${req.user.userId}, ${planId}, ${day}, ${slideIndex}, ${type}, ${imageUrl}, ${prompt}, ${aspectRatio}, ${JSON.stringify(sourceJson)}::jsonb, ${timestamp}, ${timestamp})`;
              
    console.log(`[Server API] POST /ai-images - SUCCESS, Image ID: ${id}`);
    res.json({ success: true, result: { id } });
  } catch (err) {
    console.error(`[Server API] POST /ai-images ERROR - User ID: ${req.user.userId}`, err);
    res.status(500).json({ success: false, error: 'Failed to save AI image' });
  }
});

// GET /api/data/ai-images
router.get('/ai-images', authenticate, async (req, res) => {
  const { planId } = req.query;
  console.log(`[Server API] GET /ai-images - User ID: ${req.user.userId}, Plan ID: ${planId || 'ALL'}`);
  try {
    const rows = planId 
      ? await sql`SELECT * FROM ai_images WHERE "planId" = ${planId} AND user_id = ${req.user.userId} ORDER BY day ASC, "slideIndex" ASC, "createdAt" DESC`
      : await sql`SELECT * FROM ai_images WHERE user_id = ${req.user.userId} ORDER BY day ASC, "slideIndex" ASC, "createdAt" DESC`;
      
    console.log(`[Server API] GET /ai-images - Found ${rows.length} images`);
    res.json({ success: true, result: rows });
  } catch (err) {
    console.error(`[Server API] GET /ai-images ERROR - User ID: ${req.user.userId}`, err);
    res.status(500).json({ success: false, error: 'Failed to load AI images' });
  }
});

// PUT /api/data/slides/:postId/:slideIndex
router.put('/slides/:postId/:slideIndex', authenticate, async (req, res) => {
  console.log(`[Server API] PUT /slides/:postId/:slideIndex - User ID: ${req.user.userId}, Post ID: ${req.params.postId}, Slide: ${req.params.slideIndex}`);
  try {
    const { postId, slideIndex } = req.params;
    const { newDesignSpec, newDataUrl } = req.body;
    
    const postCheck = await sql`SELECT dp.id FROM daily_posts dp JOIN plans p ON dp.plan_id = p.id WHERE dp.id = ${postId} AND p.user_id = ${req.user.userId}`;
    if (postCheck.length === 0) return res.status(403).json({ success: false, error: 'Unauthorized' });

    await sql`UPDATE post_slides SET design_spec = ${JSON.stringify(newDesignSpec)}::jsonb, generated_asset = ${newDataUrl}, status = 'edited', updated_at = CURRENT_TIMESTAMP WHERE post_id = ${postId} AND slide_index = ${slideIndex}`;
    await sql`UPDATE daily_posts SET status = 'edited', updated_at = CURRENT_TIMESTAMP WHERE id = ${postId}`;
    
    console.log(`[Server API] PUT /slides/:postId/:slideIndex - SUCCESS`);
    res.json({ success: true, message: 'Slide updated' });
  } catch (err) {
    console.error(`[Server API] PUT /slides/:postId/:slideIndex ERROR - User ID: ${req.user.userId}`, err);
    res.status(500).json({ success: false, error: 'Failed to update slide' });
  }
});

// GET /api/data/presets
router.get('/presets', authenticate, async (req, res) => {
  const { category } = req.query;
  console.log(`[Server API] GET /presets - User ID: ${req.user.userId}, Category: ${category || 'ALL'}`);
  try {
    const rows = category 
      ? await sql`SELECT id, name, spec FROM presets WHERE category = ${category} AND user_id = ${req.user.userId} ORDER BY created_at DESC`
      : await sql`SELECT id, category, name, spec, created_at FROM presets WHERE user_id = ${req.user.userId} ORDER BY category, created_at DESC`;
      
    console.log(`[Server API] GET /presets - Found ${rows.length} presets`);
    res.json({ success: true, result: rows });
  } catch (err) {
    console.error(`[Server API] GET /presets ERROR - User ID: ${req.user.userId}`, err);
    res.status(500).json({ success: false, error: 'Failed to load presets' });
  }
});

// POST /api/data/presets
router.post('/presets', authenticate, async (req, res) => {
  console.log(`[Server API] POST /presets - User ID: ${req.user.userId}, Category: ${req.body.category}, Name: ${req.body.name}`);
  try {
    const { category, name, spec } = req.body;
    await sql`INSERT INTO presets (user_id, category, name, spec, created_at) VALUES (${req.user.userId}, ${category}, ${name}, ${JSON.stringify(spec)}::jsonb, NOW())`;
    console.log(`[Server API] POST /presets - SUCCESS`);
    res.json({ success: true, message: 'Preset saved' });
  } catch (err) {
    console.error(`[Server API] POST /presets ERROR - User ID: ${req.user.userId}`, err);
    res.status(500).json({ success: false, error: 'Failed to save preset' });
  }
});

// DELETE /api/data/presets/:id
router.delete('/presets/:id', authenticate, async (req, res) => {
  console.log(`[Server API] DELETE /presets/:id - User ID: ${req.user.userId}, Preset ID: ${req.params.id}`);
  try {
    await sql`DELETE FROM presets WHERE id = ${req.params.id} AND user_id = ${req.user.userId}`;
    console.log(`[Server API] DELETE /presets/:id - SUCCESS`);
    res.json({ success: true, message: 'Preset deleted' });
  } catch (err) {
    console.error(`[Server API] DELETE /presets/:id ERROR - User ID: ${req.user.userId}`, err);
    res.status(500).json({ success: false, error: 'Failed to delete preset' });
  }
});

// DELETE /api/data/ai-images/:id
router.delete('/ai-images/:id', authenticate, async (req, res) => {
  console.log(`[Server API] DELETE /ai-images/:id - User ID: ${req.user.userId}, Image ID: ${req.params.id}`);
  try {
    const check = await sql`SELECT id FROM ai_images WHERE id = ${req.params.id} AND user_id = ${req.user.userId}`;
    if (check.length === 0) return res.status(403).json({ success: false, error: 'Unauthorized' });
    
    await sql`DELETE FROM ai_images WHERE id = ${req.params.id}`;
    console.log(`[Server API] DELETE /ai-images/:id - SUCCESS`);
    res.json({ success: true, message: 'AI image deleted' });
  } catch (err) {
    console.error(`[Server API] DELETE /ai-images/:id ERROR - User ID: ${req.user.userId}`, err);
    res.status(500).json({ success: false, error: 'Failed to delete AI image' });
  }
});

// PUT /api/data/ai-images/:id
router.put('/ai-images/:id', authenticate, async (req, res) => {
  console.log(`[Server API] PUT /ai-images/:id - User ID: ${req.user.userId}, Image ID: ${req.params.id}`);
  try {
    const check = await sql`SELECT id FROM ai_images WHERE id = ${req.params.id} AND user_id = ${req.user.userId}`;
    if (check.length === 0) return res.status(403).json({ success: false, error: 'Unauthorized' });
    
    const { imageUrl, prompt, sourceJson } = req.body;
    await sql`UPDATE ai_images SET "imageUrl" = ${imageUrl}, prompt = ${prompt}, "sourceJson" = ${sourceJson ? JSON.stringify(sourceJson) : null}::jsonb, "updatedAt" = ${Date.now()} WHERE id = ${req.params.id}`;
    
    console.log(`[Server API] PUT /ai-images/:id - SUCCESS`);
    res.json({ success: true, message: 'AI image updated' });
  } catch (err) {
    console.error(`[Server API] PUT /ai-images/:id ERROR - User ID: ${req.user.userId}`, err);
    res.status(500).json({ success: false, error: 'Failed to update AI image' });
  }
});

// GET /api/data/slides/plan/:planId
router.get('/slides/plan/:planId', authenticate, async (req, res) => {
  console.log(`[Server API] GET /slides/plan/:planId - User ID: ${req.user.userId}, Plan ID: ${req.params.planId}`);
  try {
    const planCheck = await sql`SELECT id FROM plans WHERE id = ${req.params.planId} AND user_id = ${req.user.userId}`;
    if (planCheck.length === 0) return res.status(403).json({ success: false, error: 'Unauthorized' });
    
    const rows = await sql`
      SELECT ps.id as slide_id, ps.post_id, ps.slide_index, ps.role, ps.design_spec, ps.generated_asset, ps.status, dp.day, dp.type, dp.metadata 
      FROM post_slides ps 
      JOIN daily_posts dp ON ps.post_id = dp.id 
      WHERE dp.plan_id = ${req.params.planId} AND ps.generated_asset IS NOT NULL 
      ORDER BY dp.day ASC, ps.slide_index ASC
    `;
    
    console.log(`[Server API] GET /slides/plan/:planId - Found ${rows.length} slides with assets`);
    const slides = rows.map(r => ({
      slideId: r.slide_id,
      postId: r.post_id,
      slideIndex: r.slide_index,
      role: r.role,
      designSpec: r.design_spec,
      generatedAsset: r.generated_asset,
      status: r.status,
      day: r.day,
      type: r.type,
      title: r.metadata?.title || `Day ${r.day}`
    }));
    
    res.json({ success: true, result: slides });
  } catch (err) {
    console.error(`[Server API] GET /slides/plan/:planId ERROR - User ID: ${req.user.userId}`, err);
    res.status(500).json({ success: false, error: 'Failed to load slides' });
  }
});

export default router;
