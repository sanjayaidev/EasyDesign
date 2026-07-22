const fs = require('fs');
const { Pool } = require('pg');

// Railway automatically injects DATABASE_URL
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
    // 1. Read the JSON file
    const raw = fs.readFileSync('./post_slides.json', 'utf8');
    const slides = JSON.parse(raw);
    console.log(`📦 Found ${slides.length} slides to insert...`);

    const client = await pool.connect();

    try {
        // 2. Start a transaction (all or nothing)
        await client.query('BEGIN');

        for (let i = 0; i < slides.length; i++) {
            const s = slides[i];

            // Parse design_spec: if it's a stringified JSON, parse it to an object
            let designSpec = null;
            if (s.design_spec) {
                designSpec = typeof s.design_spec === 'string'
                    ? JSON.parse(s.design_spec)
                    : s.design_spec;
            }

            await client.query(
                `INSERT INTO post_slides (id, post_id, slide_index, role, design_spec, generated_asset, status, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT (id) DO NOTHING`,
                [
                    s.id,
                    s.post_id,
                    s.slide_index,
                    s.role,
                    designSpec,        // jsonb
                    s.generated_asset, // text (base64 or null)
                    s.status,
                    s.created_at,
                    s.updated_at
                ]
            );

            if ((i + 1) % 25 === 0 || i === slides.length - 1) {
                console.log(`✅ ${i + 1} / ${slides.length} rows inserted`);
            }
        }

        await client.query('COMMIT');
        console.log('🎉 Migration complete!');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Migration failed, rolled back:', err.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();