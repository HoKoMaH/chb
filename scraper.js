const axios = require('axios');
const AdmZip = require('adm-zip');

async function fetchAllPossibleSubs(imdbId) {
    console.log(`[SCRAPER] جاري البحث عن ترجمات في SubDL لـ: ${imdbId}`);
    const results = [];
    
    // تأكد من إضافة المفتاح في Render Environment Variables
    const API_KEY = process.env.SUBDL_API_KEY; 

    try {
        // 1. طلب البحث من API SubDL
        const searchUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&languages=ar&api_key=${API_KEY}`;
        const response = await axios.get(searchUrl);

        if (response.data && response.data.status && response.data.subtitles.length > 0) {
            // نأخذ أفضل 5 نتائج للمزامنة
            const subs = response.data.subtitles.slice(0, 5);
            console.log(`[SUBDL] تم العثور على ${subs.length} نسخة مترجمة.`);

            for (let sub of subs) {
                try {
                    // 2. تحميل ملف الـ ZIP
                    const dlUrl = `https://dl.subdl.com${sub.url}`; // قد تختلف حسب تحديث الـ API
                    const zipResponse = await axios.get(sub.download_url || dlUrl, {
                        responseType: 'arraybuffer'
                    });

                    // 3. فك ضغط الملف في الذاكرة (Memory)
                    const zip = new AdmZip(Buffer.from(zipResponse.data));
                    const zipEntries = zip.getEntries();

                    // البحث عن أول ملف ينتهي بـ .srt داخل الـ ZIP
                    const srtEntry = zipEntries.find(entry => entry.entryName.endsWith('.srt'));

                    if (srtEntry) {
                        const srtText = srtEntry.getData().toString('utf8');
                        
                        results.push({
                            content: srtText,
                            releaseName: sub.release_name || "نسخة مزمّنة",
                            source: "SubDL"
                        });
                        console.log(`[SCRAPER] ✅ تم تجهيز النسخة: ${sub.release_name}`);
                    }
                } catch (err) {
                    console.error(`[SCRAPER] خطأ في معالجة ملف ZIP: ${err.message}`);
                }
            }
        }
    } catch (e) {
        console.error(`[SCRAPER-ERROR] فشل الجلب من SubDL: ${e.message}`);
    }

    return results;
}

module.exports = { fetchAllPossibleSubs };
