const { addonBuilder } = require("stremio-addon-sdk");
const engine = require("./engine");

const manifest = {
    id: "community.ar.sa.smart",
    version: "8.0.0",
    name: "AR.SA Smart Subtitles",
    description: "ترجمة عربية ذكية ومزامنة تلقائية",
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
        // جلب الترجمات من المحرك
        const subs = await engine.getSyncedSubtitles(id, videoFileName);
        
        if (!subs || subs.length === 0) {
            console.log(`[STREMIO] ⚠️ لا توجد ترجمات متاحة حالياً لـ: ${id}`);
            return { subtitles: [] };
        }

        // تحويل النتائج لتنسيق Stremio الصحيح
        const formattedSubs = subs.map(sub => ({
            id: sub.fileId,
            // التأكد من أن الرابط يشير لسيرفر Render الخاص بك وينتهي بـ .srt
            url: `https://chb-gy3n.onrender.com/sub/${sub.fileId}.srt`,
            name: `${sub.isAI ? '🤖 ' : '🇸🇦 '}${sub.label}`
        }));

        console.log(`[STREMIO] ✅ تم إرسال ${formattedSubs.length} ترجمة بنجاح.`);
        return { subtitles: formattedSubs };
    } catch (e) {
        console.error(`[STREMIO-ERROR] ❌ خطأ: ${e.message}`);
        return { subtitles: [] };
    }
});

module.exports = builder.getInterface();
