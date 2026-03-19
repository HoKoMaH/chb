const { addonBuilder } = require("stremio-addon-sdk");
const { createClient } = require('@supabase/supabase-js');

// إعداد عميل Supabase داخل الـ Addon للوصول للبيانات
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const manifest = {
    id: "community.ar_sa.ai",
    version: "8.0.0",
    name: "AI Subtitles By HoKoMaH",
    description: "ترجمات عربية حصرية بالذكاء الاصطناعي 🇸🇦 عبر Supabase",
    logo: "https://i.imgur.com/huxCzjK.png",
    background: "https://i.imgur.com/Is1Dciv.png",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

builder.defineSubtitlesHandler(async (args) => {
    const { id } = args; // معرف الفيلم tt...
    try {
        // جلب الترجمات الخاصة بهذا الـ ID من Supabase
        const { data: results, error } = await supabase
            .from('subtitles')
            .select('*')
            .eq('imdb_id', id);

        if (error || !results || results.length === 0) return { subtitles: [] };

        return {
            subtitles: results.map((s) => ({
                id: s.file_id,
                url: `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'chb-gy3n.onrender.com'}/sub/${s.file_id}.srt`,
                lang: "ar-SA",
                label: `🇸🇦 ${s.label} ${s.is_ai ? '[AI]' : '[OFFICIAL]'}`
            }))
        };
    } catch (e) { 
        console.error("Subtitles Error:", e);
        return { subtitles: [] }; 
    }
});

module.exports = builder.getInterface();
