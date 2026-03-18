async function fetchAllPossibleSubs(fullId, videoFileName) {
    const API_KEY = process.env.SUBDL_API_KEY;
    // تقسيم المعرف بشكل آمن للمسلسلات
    const parts = fullId.split(':');
    const imdbId = parts[0];
    const season = parts[1];
    const episode = parts[2];

    console.log(`[SCRAPER-START] 🛰️ فحص: ${imdbId} | موسم: ${season || 'N/A'} | حلقة: ${episode || 'N/A'}`);
    let results = [];

    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${API_KEY}`;
        if (season && episode) baseUrl += `&season=${season}&episode=${episode}`;

        // 1. فحص العربية
        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        if (arRes?.data?.subtitles?.length > 0) {
            console.log(`[SCRAPER] ✨ وجدنا عربي جاهز، لن نستخدم الذكاء الاصطناعي.`);
            results = await processSubs(arRes.data.subtitles.slice(0, 2), "Original");
        } 

        // 2. إذا لم نجد عربي (هنا بيت القصيد)
        if (results.length === 0) {
            console.log(`[SCRAPER] 🔍 لا يوجد عربي. جاري جلب الإنجليزية للترجمة...`);
            const enRes = await axios.get(`${baseUrl}&languages=en`).catch(() => null);

            if (enRes?.data?.subtitles?.length > 0) {
                console.log(`[SCRAPER] 📥 وجدنا ${enRes.data.subtitles.length} نسخة إنجليزية.`);
                
                // اختيار أفضل نسخة
                const bestEnSub = enRes.data.subtitles[0]; 
                console.log(`[SCRAPER] 🎯 النسخة المختارة: ${bestEnSub.release_name}`);

                const enSrt = await downloadAndUnzip(bestEnSub.url);
                if (enSrt) {
                    // الانتقال الإجباري لدالة الترجمة
                    const translatedAr = await translateSrt(enSrt);
                    if (translatedAr) {
                        results.push({ content: translatedAr, releaseName: bestEnSub.release_name, source: "AI" });
                    }
                } else {
                    console.log(`[SCRAPER-ERROR] ❌ فشل تحميل أو فك ضغط الملف الإنجليزي.`);
                }
            } else {
                console.log(`[SCRAPER] ❌ لا توجد حتى نسخة إنجليزية في SubDL لهذا المحتوى.`);
            }
        }
    } catch (e) {
        console.error(`[SCRAPER-CRITICAL] ❌ خطأ في السكرابر: ${e.message}`);
    }
    return results;
}
