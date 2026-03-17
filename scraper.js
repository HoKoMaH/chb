const axios = require('axios');
const AdmZip = require('adm-zip');

async function fetchSubs(imdbId) {
    const cleanId = imdbId.split(':')[0].replace('tt', '');
    const fullId = `tt${cleanId}`;
    
    // هيدرز قوية جداً لمحاكاة متصفح Chrome حقيقي
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
        'Referer': 'https://subdl.com/',
        'Origin': 'https://subdl.com',
        'Connection': 'keep-alive'
    };

    try {
        console.log(`[SCRAPER] جاري البحث عن: ${fullId}`);
        const url = `https://api.subdl.com/api/v1/subtitles?api_key=${process.env.SUBDL_API_KEY}&imdb_id=${fullId}&languages=ar`;
        
        const res = await axios.get(url, { headers, timeout: 10000 });

        if (res.data?.subtitles?.length > 0) {
            // نأخذ أول نتيجة (غالباً الأفضل)
            let dlUrl = res.data.subtitles[0].url;
            
            // تصحيح الرابط إذا كان ناقصاً
            if (!dlUrl.startsWith('http')) {
                dlUrl = `https://subdl.com${dlUrl.startsWith('/') ? '' : '/'}${dlUrl}`;
            }

            console.log(`[DOWNLOAD-ATTEMPT] محاولة تحميل: ${dlUrl}`);

            // التحميل باستخدام Buffer مع إجبار السيرفر على قبول الطلب
            const subRes = await axios.get(dlUrl, { 
                headers: {
                    ...headers,
                    'Accept': 'application/octet-stream' // نطلب ملف خام وليس نص
                }, 
                responseType: 'arraybuffer',
                timeout: 20000 
            });

            const buffer = Buffer.from(subRes.data);

            // فحص المحتوى: هل هو ZIP فعلاً؟ (توقيع ملفات ZIP يبدأ بـ PK)
            if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
                const zip = new AdmZip(buffer);
                const srtEntry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt'));
                
                if (srtEntry) {
                    const text = srtEntry.getData().toString('utf8');
                    console.log(`[SUCCESS] تم فك الضغط بنجاح لفيلم ${fullId}`);
                    return { araRaw: text, engRaw: text, source: "SubDL-Bypass" };
                }
            } else {
                // إذا لم يكن مضغوطاً، قد يكون ملف SRT مباشر
                const text = buffer.toString('utf8');
                if (text.includes('1') && text.includes('-->')) {
                    console.log(`[SUCCESS] تم جلب ملف SRT مباشر.`);
                    return { araRaw: text, engRaw: text, source: "SubDL-Direct" };
                }
            }
        }
    } catch (e) {
        console.error(`[FATAL-ERROR] خطأ ${e.response?.status || 'Unknown'}: ${e.message}`);
        // إذا استمر الـ 404، فهذا يعني أن الرابط يتطلب API Key "مدفوع" للتحميل المباشر
    }
    return null;
}

module.exports = { fetchSubs };
