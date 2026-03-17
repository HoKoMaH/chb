const axios = require('axios');

async function fetchAllPossibleSubs(imdbId) {
    console.log(`[SCRAPER] جاري البحث عن كافة الترجمات لـ: ${imdbId}`);
    
    // تنظيف الـ ID من tt
    const id = imdbId.replace('tt', '');

    try {
        // سنستخدم مصدر بديل أو طريقة جلب لا تتطلب API Key معقد في البداية
        // ملاحظة: إذا كان لديك API Key من OpenSubtitles v3، تأكد من وضعه في Render Environment Variables
        
        const response = await axios.get(`https://api.opensubtitles.com/api/v1/subtitles`, {
            params: { imdb_id: id, languages: 'ar' },
            headers: {
                'Api-Key': process.env.OPENSUBTITLES_API_KEY || 'YOUR_FREE_API_KEY', // ضع مفتاحك هنا
                'User-Agent': 'Stremio-AR-Sync v1.2',
                'Accept': 'application/json'
            }
        });

        if (response.data && response.data.data.length > 0) {
            const results = [];
            // جلب أفضل 5 نتائج لضمان المزامنة
            const entries = response.data.data.slice(0, 5);

            for (let entry of entries) {
                // استخراج اسم النسخة للمزامنة (مثلاً: 1080p.BluRay.x264)
                const releaseName = entry.attributes.release || entry.attributes.feature_details.title;
                
                // جلب رابط التحميل
                const dlResponse = await axios.post('https://api.opensubtitles.com/api/v1/download', 
                    { file_id: entry.attributes.files[0].file_id },
                    { headers: { 'Api-Key': process.env.OPENSUBTITLES_API_KEY } }
                );

                if (dlResponse.data && dlResponse.data.link) {
                    const srt = await axios.get(dlResponse.data.link);
                    results.push({
                        content: srt.data,
                        releaseName: releaseName,
                        source: "OpenSubtitles"
                    });
                }
            }
            return results;
        }
    } catch (e) {
        // إذا استمر خطأ 403، سنطبع رسالة واضحة
        console.error(`[SCRAPER-ERROR] الحظر مستمر (403): ${e.response ? e.response.status : e.message}`);
        
        // كخطة بديلة (Backup) يمكنك استخدام مكتبة سكرابر أخرى هنا
        return [];
    }
    return [];
}

module.exports = { fetchAllPossibleSubs };
