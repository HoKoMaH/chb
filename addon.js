const { addonBuilder } = require("stremio-addon-sdk");
const engine = require("./engine");

const manifest = {
    id: "community.ar.sa.smart",
    version: "8.1.0", // رفع النسخة ضروري جداً الآن
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

    console.log(`[STREMIO] 📥 طلب جديد: ${id}`);

    try {
        // ننتظر النتيجة لمدة 9 ثوانٍ كحد أقصى لكي لا نفقد الطلب
        const subs = await Promise.race([
            engine.getSyncedSubtitles(id, videoFileName),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 9000))
        ]);

        if (!subs || subs.length === 0) return { subtitles: [] };

        const formattedSubs = subs.map(sub => ({
            id: sub.fileId,
            url: `https://chb-gy3n.onrender.com/sub/${sub.fileId}.srt`,
            name: `${sub.isAI ? '🤖' : '🇸🇦'} ${sub.label}`
        }));

        console.log(`[STREMIO] ✅ تم إرسال ${formattedSubs.length} ترجمة.`);
        return { subtitles: formattedSubs };
    } catch (e) {
        console.error(`[STREMIO-ERROR] ❌ خطأ: ${e.message}`);
        return { subtitles: [] };
    }
});

module.exports = builder.getInterface();
