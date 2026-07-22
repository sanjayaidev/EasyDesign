import fs from 'fs';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkMissing() {
    const raw = fs.readFileSync('./post_slides.json', 'utf8');
    const slides = JSON.parse(raw);
    
    // Get unique post_ids from the slides JSON
    const uniquePostIds = [...new Set(slides.map(s => s.post_id))];
    console.log(`🔍 Checking ${uniquePostIds.length} unique post_ids from JSON...`);

    const client = await pool.connect();
    try {
        // Ask the database which of these IDs actually exist
        const res = await client.query(
            'SELECT id FROM daily_posts WHERE id = ANY($1)',
            [uniquePostIds]
        );
        
        const existingIds = res.rows.map(row => row.id);
        const missingIds = uniquePostIds.filter(id => !existingIds.includes(id));

        if (missingIds.length === 0) {
            console.log('✅ Good news: All post_ids exist in the database!');
        } else {
            console.log(`❌ Found ${missingIds.length} missing post_ids in the database:`);
            console.log(missingIds);
        }
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

checkMissing();
