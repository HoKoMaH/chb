const { addonBuilder } = require("stremio-addon-sdk");
const engine = require("./engine");

const manifest = {
    id: "community.ar.sa.pro.independent", // معرف فريد لضمان تحديث الإضافة في ستريميو
    version: "8.5.0",
    name: "AR.SA Ultimate",
    description: "محرك الترجمة العربية المستقل والتعريب الآلي",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

builder.defineSubtitlesHandler(async (args) => {
    const { id, extra } = args;
    const videoFileName = extra.filename || "";
    const domain = process.env.RENDER_EXTERNAL_HOSTNAME || "chb-gy3n.onrender.com";

    console.log(`[STREMIO] 📥 طلب جديد لـ: ${id}`);

    try {
        // جلب الترجمات من المحرك (سواء محلية أو خارجية)
        const subtitlesList = await engine.getSyncedSubtitles(id, videoFileName);
        
        if (!subtitlesList || subtitlesList.length === 0) {
            return { subtitles: [] };
        }

        // تحويل البيانات لتنسيق ستريميو الذي يظهر في القائمة اليسرى
        const formattedSubtitles = subtitlesList.map(sub => {
            // منطق تحديد النجمة (إذا كانت الترجمة متوافقة تماماً مع اسم الملف)
            const isMatch = videoFileName && sub.label && 
                           sub.label.split(' ').some(word => videoFileName.includes(word));

            return {
                id: sub.fileId,
                // السر هنا: نضع اسم اللغة "AR.SA 🇸🇦" لتظهر في القائمة اليسرى بشكل منفصل
                lang: "ar-sa", 
                // الرابط المباشر للملف من سيرفرك
                url: `https://${domain}/sub/${sub.fileId}.srt`,
                // ما يظهر في القائمة اليمنى (Variants)
                name: isMatch ? `⭐ ${sub.label}` : `🇸🇦 ${sub.label}`
            };
        });

        console.log(`[STREMIO] ✅ تم إرسال ${formattedSubtitles.length} ترجمة تحت قسم AR.SA`);
        return { subtitles: formattedSubtitles };

    } catch (e) {
        console.error(`[STREMIO-ERROR] ❌ فشل في معالجة الطلب: ${e.message}`);
        return { subtitles: [] };
    }
});

module.exports = builder.getInterface();
