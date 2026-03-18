const { addonBuilder } = require("stremio-addon-sdk");
const engine = require("./engine");

const manifest = {
    id: "community.ar.sa.pro.ultimate", // تغيير الـ ID لكسر الكاش تماماً
    version: "8.3.0",
    name: "AR.SA Ultimate",
    description: "محرك الترجمة العربية الاحترافي",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

builder.defineSubtitlesHandler(async (args) => {
    const { id, extra } = args;
    const videoFileName = extra.filename || "";

    try {
        const subs = await engine.getSyncedSubtitles(id, videoFileName);
        
        if (!subs || subs.length === 0) return { subtitles: [] };

        const formattedSubs = subs.map(sub => ({
            id: sub.fileId,
            url: `https://chb-gy3n.onrender.com/sub/${sub.fileId}.srt`,
            // السر هنا: نضع اسم اللغة "AR.SA" بدلاً من "Arabic" لتظهر يساراً بشكل منفصل
            lang: "AR.SA 🇸🇦", 
            name: sub.label // اسم النسخة (BluRay, YTS, إلخ)
        }));

        console.log(`[STREMIO] ✅ تم إرسال ${formattedSubs.length} ترجمة تحت قائمة AR.SA`);
        return { subtitles: formattedSubs };
    } catch (e) {
        return { subtitles: [] };
    }
});

module.exports = builder.getInterface();
