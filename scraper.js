const axios = require('axios');
const AdmZip = require('adm-zip');

async function fetchSubs(imdbId) {
    const cleanId = imdbId.split(':')[0].replace('tt', '');
    const fullId = `tt${cleanId}`;
    
    // هيدرز بسيطة لمحاكاة متصفح
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    try {
        console.log(`[RENDER-SCRAPER] البحث عن: ${fullId}`);
        const url = `https://api.subdl.com/api/v1/subtitles?api_key=${process.env.SUBDL_API_KEY}&imdb_id=${fullId}&languages=ar`;
        
        const res = await axios.get(url, { headers, timeout: 10000 });

        if (res.data?.subtitles?.length > 0) {
            let dlUrl = res.data.subtitles[0].url;
            if (!dlUrl.startsWith('http')) dlUrl = `https://subdl.com${dlUrl}`;

            console.log(`[RENDER-DL] تحميل الملف من: ${dlUrl}`);

            const subRes = await axios.get(dlUrl, { 
                headers, 
                responseType: 'arraybuffer',
                timeout: 15000 
            });

            // فك الضغط في الذاكرة
            const zip = new AdmZip(Buffer.from(subRes.data));
            const srtEntry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt'));
            
            if (srtEntry) {
                const text = srtEntry.getData().toString('utf8');
                console.log(`[RENDER-SUCCESS] تم استخراج الترجمة.`);
                return { araRaw: text, engRaw: text, source: "SubDL-Render" };
            }
        }
    } catch (e) {
        console.error(`[RENDER-ERROR] فشل: ${e.message}`);
    }
    return null;
}

module.exports = { fetchSubs };
