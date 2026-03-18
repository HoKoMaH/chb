const { addonBuilder } = require("stremio-addon-sdk");
const engine = require("./engine");

// تحديث رقم الإصدار مهم جداً لظهور النتائج الجديدة وتجاوز الكاش
const manifest = {
    id: "community.ar.sa.smart",
    version: "8.0.5",
    name: "AR.SA Smart Subtitles",
    description: "البحث الشامل والتعريب الآلي لكافة الأفلام والمسلسلات",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

builder.defineSubtitlesHandler(async (args) => {
    const { id, extra } = args;
    const videoFileName = extra.filename || "";

    console.log(`[STREMIO-REQUEST] 📥 طلب لـ: ${id} | ملف: ${videoFileName}`);

    try {
        // نضع مهلة زمنية 9 ثوانٍ كحد أقصى قبل أن يقطع ستريميو الاتصال
        const subs = await Promise.race([
            engine.getSyncedSubtitles(id, videoFileName),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 9500))
        ]);

        if (!subs || subs.length === 0) {
            console.log(`[STREMIO] ⚠️ لا توجد ترجمات حالياً لـ ${id}`);
            return { subtitles: [] };
        }

        const formattedSubs = subs.map(sub => ({
            id: sub.fileId,
            // نستخدم الرابط المباشر للسيرفر مع التأكد من صيغة .srt
            url: `https://chb-gy3n.onrender.com/sub/${sub.fileId}.srt`,
            name: `${sub.isAI ? '🤖' : '🇸🇦'} ${sub.label}`
        }));

        console.log(`[STREMIO] ✅ تم إرسال ${formattedSubs.length} ترجمة بنجاح.`);
        return { subtitles: formattedSubs };
    } catch (e) {
        console.error(`[STREMIO-ERROR] ❌ خطأ أو تأخير: ${e.message}`);
        return { subtitles: [] };
    }
});

module.exports = builder.getInterface();
