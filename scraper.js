const axios = require('axios');

// دالة لجلب قائمة ترجمات بدلاً من واحدة فقط
async function fetchAllPossibleSubs(imdbId) {
    console.log(`[SCRAPER] جاري البحث عن كافة الترجمات لـ: ${imdbId}`);
    
    try {
        // تنظيف الـ ID
        const id = imdbId.replace('tt', '');
        
        // مثال باستخدام OpenSubtitles (تأكد من إعداد الـ API Key الخاص بك في Environment Variables)
        const response = await axios.get(`https://api.opensubtitles.com/api/v1/subtitles`, {
            params: {
                imdb_id: id,
                languages: 'ar'
            },
            headers: {
                'Api-Key': process.env.OPENSUBTITLES_API_KEY, // تأكد من إضافة هذا في رندر
                'User-Agent': 'StremioArabic v1.0'
            }
        });

        if (response.data && response.data.data.length > 0) {
            // جلب أول 5 نتائج للمزامنة
            const subEntries = response.data.data.slice(0, 5);
            
            let results = [];
            for (let entry of subEntries) {
                // جلب رابط التحميل الفعلي لكل ملف
                const downloadLink = await axios.post(`https://api.opensubtitles.com/api/v1/download`, 
                { file_id: entry.attributes.files[0].file_id },
                {
                    headers: {
                        'Api-Key': process.env.OPENSUBTITLES_API_KEY,
                        'Content-Type': 'application/json'
                    }
                });

                // جلب نص الترجمة (SRT)
                const srtContent = await axios.get(downloadLink.data.link);

                results.push({
                    content: srtContent.data,
                    releaseName: entry.attributes.release || entry.attributes.feature_details.title,
                    source: "OpenSubtitles V3"
                });
            }
            return results;
        }
    } catch (e) {
        console.error(`[SCRAPER-ERROR] فشل الجلب: ${e.message}`);
        
        // حالة طوارئ: إذا فشل الـ API المتقدم، نستخدم السكرابر البسيط القديم (إذا كان متاحاً)
        return [];
    }
    return [];
}

// السطر الذي يحل مشكلة الـ Missing Function
module.exports = { fetchAllPossibleSubs };
