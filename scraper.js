const axios = require('axios');

async function fetchAllPossibleSubs(imdbId) {
    console.log(`[SCRAPER] جاري البحث عن ترجمات لـ: ${imdbId}`);
    const results = [];

    try {
        // المصدر الأول: SubDL (أكثر استقراراً مع رندر)
        const subdlUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&languages=ar&api_key=${process.env.SUBDL_API_KEY || ''}`;
        
        const response = await axios.get(subdlUrl, { timeout: 5000 }).catch(() => null);

        if (response && response.data && response.data.status && response.data.subtitles.length > 0) {
            console.log(`[SUBDL] تم العثور على ${response.data.subtitles.length} ترجمة`);
            
            for (let sub of response.data.subtitles.slice(0, 5)) {
                // جلب رابط التحميل (SubDL يحتاج فك ضغط أحياناً، لكن سنحاول جلب النص المباشر)
                const dlUrl = `https://subdl.com/s/subtitle/${sub.url}`;
                // ملاحظة: قد تحتاج لمكتبة 'adm-zip' إذا كان الملف مضغوطاً
                
                results.push({
                    content: "تم العثور على ترجمة - رابط التحميل يتطلب معالجة ZIP", // سنعالج هذا في الخطوة القادمة
                    releaseName: sub.release_name || "نسخة مزمّنة",
                    source: "SubDL"
                });
            }
        }

        // إذا فشل كل شيء، نعود لمحاولة البحث بـ Scraper بسيط لا يتطلب API
        if (results.length === 0) {
            console.log(`[SCRAPER] محاولة البحث البديل لتجنب 403...`);
            // هنا يمكنك استخدام Scraper يعتمد على محاكاة المتصفح (Browser Header)
        }

    } catch (e) {
        console.error(`[SCRAPER-ERROR] فشل كلي: ${e.message}`);
    }
    
    return results;
}

module.exports = { fetchAllPossibleSubs };
