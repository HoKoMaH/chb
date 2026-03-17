const axios = require('axios');

async function fetchSubs(imdbId) {
    const cleanId = imdbId.split(':')[0].replace('tt', '');
    const api_key = process.env.OPENSUBTITLES_API_KEY;

    // إعداد الهيدرز الرسمية المطلوبة من OpenSubtitles
    const headers = {
        'Api-Key': api_key,
        'User-Agent': 'StremioArabicV3', // يجب أن يكون فريداً
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };

    try {
        console.log(`[OS-API] جاري البحث عن الفيلم ID: ${cleanId}`);
        
        // 1. البحث عن الترجمة (نطلب العربية فقط لتقليل الضغط)
        const searchUrl = `https://api.opensubtitles.com/api/v1/subtitles?imdb_id=${cleanId}&languages=ar`;
        const res = await axios.get(searchUrl, { headers, timeout: 10000 });

        if (res.data && res.data.data && res.data.data.length > 0) {
            // نختار أول نتيجة (الأكثر تحميلًا عادةً)
            const subData = res.data.data[0];
            const fileId = subData.attributes.files[0].file_id;
            const fileName = subData.attributes.release;

            console.log(`[OS-FOUND] تم العثور على: ${fileName}`);

            // 2. خطوة "طلب رابط التحميل" (هذه هي الخطوة التي تمنع الـ 403)
            const dlResponse = await axios.post('https://api.opensubtitles.com/api/v1/download', 
                { file_id: fileId }, 
                { headers, timeout: 10000 }
            );

            if (dlResponse.data && dlResponse.data.link) {
                const downloadLink = dlResponse.data.link;
                console.log(`[OS-DL] جاري جلب ملف SRT من الرابط المؤقت...`);

                // 3. جلب محتوى الملف النصي مباشرة
                const srtRes = await axios.get(downloadLink, { timeout: 15000 });
                
                if (typeof srtRes.data === 'string' && srtRes.data.includes('-->')) {
                    console.log(`[SUCCESS] تم جلب الترجمة بنجاح!`);
                    return { 
                        araRaw: srtRes.data, 
                        engRaw: srtRes.data, 
                        source: "OpenSubtitles-v3" 
                    };
                }
            }
        } else {
            console.log(`[OS-INFO] لم يتم العثور على ترجمة عربية لهذا الـ ID في OpenSubtitles.`);
        }
    } catch (e) {
        console.error(`[OS-ERROR] فشل الطلب: ${e.response?.status || e.message}`);
        if (e.response?.status === 401) console.error("تنبيه: مفتاح الـ API غير صالح أو انتهت صلاحيته.");
    }

    return null;
}

module.exports = { fetchSubs };
