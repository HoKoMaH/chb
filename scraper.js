const axios = require('axios');
const AdmZip = require('adm-zip');

async function fetchSubs(imdbId) {
    const cleanId = imdbId.split(':')[0].replace('tt', '');
    const fullId = `tt${cleanId}`;
    console.log(`[SCRAPER] جاري البحث المكثف عن: ${fullId}`);

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };

    try {
        // 1. محاولة جلب البيانات من SubDL (باستخدام بروكسي للطلب نفسه)
        const subDlUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://api.subdl.com/api/v1/subtitles?api_key=${process.env.SUBDL_API_KEY}&imdb_id=${fullId}&languages=ar`)}`;
        
        console.log(`[PROXY] جاري طلب البيانات عبر الوسيط...`);
        const res = await axios.get(subDlUrl, { timeout: 15000 });

        if (res.data?.subtitles?.length > 0) {
            let dlUrl = res.data.subtitles[0].url;
            if (!dlUrl.startsWith('http')) dlUrl = `https://subdl.com${dlUrl}`;

            console.log(`[DOWNLOAD] تم العثور على رابط، جاري التحميل...`);

            // 2. تحميل الملف (Buffer)
            const subRes = await axios.get(dlUrl, { 
                headers, 
                responseType: 'arraybuffer',
                timeout: 20000 
            });

            const buffer = Buffer.from(subRes.data);

            // 3. فحص نوع الملف (ZIP أو SRT)
            if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
                console.log(`[ZIP] فك ضغط الملف...`);
                const zip = new AdmZip(buffer);
                const srt = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt'));
                if (srt) {
                    const text = srt.getData().toString('utf8');
                    console.log(`[SUCCESS] تم استخراج الترجمة بنجاح.`);
                    return { araRaw: text, engRaw: text, source: "SubDL (Final)" };
                }
            } else {
                const text = buffer.toString('utf8');
                if (text.includes('1')) {
                    console.log(`[SUCCESS] تم جلب ملف SRT مباشر.`);
                    return { araRaw: text, engRaw: text, source: "SubDL (Direct)" };
                }
            }
        }
    } catch (e) {
        console.error(`[SCRAPER ERROR] فشل نهائي: ${e.message}`);
    }

    return null;
}

module.exports = { fetchSubs };