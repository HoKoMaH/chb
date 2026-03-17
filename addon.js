const { addonBuilder } = require("stremio-addon-sdk");
const mongoose = require('mongoose');
const { fetchSubs } = require('./scraper');
const { syncSrt } = require('./engine');

const SubSchema = new mongoose.Schema({
    id: String, content: String, source: String,
    createdAt: { type: Date, expires: '6h', default: Date.now }
});

const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', SubSchema);

const manifest = {
    id: "org.arabic.autosync.v2",
    name: "Arabic Auto-Sync v2.0",
    version: "2.0.0",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [] 
};

const builder = new addonBuilder(manifest);

builder.defineSubtitlesHandler(async (args) => {
    const { id } = args;
    console.log(`[REQUEST] جاري البحث عن ترجمة للفيلم: ${id}`);

    try {
        // 1. البحث في قاعدة البيانات
        const cached = await Subtitle.findOne({ id });
        if (cached) {
            console.log(`[CACHE HIT] تم العثور على نسخة مزامنة مسبقاً في MongoDB لـ: ${id}`);
            return { subtitles: [{ url: `data:application/x-subrip;base64,${cached.content}`, label: `[DB Synced] ${cached.source}`, lang: "ara" }] };
        }

        console.log(`[SCRAPER] لم يتم العثور في الكاش، جاري الجلب من المصادر الخارجية...`);

        // 2. الجلب من المصادر
        const data = await fetchSubs(id);
        
        if (!data) {
            console.warn(`[NOT FOUND] للأسف، لم تتوفر ترجمة عربية وإنجليزية مطابقة لـ: ${id} في المصادر الحالية.`);
            return { subtitles: [] };
        }

        console.log(`[FOUND] تم العثور على ترجمة من مصدر: ${data.source}. جاري المزامنة الآن...`);

        // 3. المزامنة
        const synced = await syncSrt(data.araRaw, data.engRaw);
        if (!synced) {
            console.error(`[SYNC ERROR] فشلت عملية المزامنة الرياضية لـ: ${id}`);
            return { subtitles: [] };
        }

        const base64 = Buffer.from(synced).toString('base64');
        
        // 4. الحفظ
        await new Subtitle({ id, content: base64, source: data.source }).save();
        console.log(`[SUCCESS] تم مزامنة وحفظ الترجمة بنجاح لـ: ${id}`);

        return { subtitles: [{ url: `data:application/x-subrip;base64,${base64}`, label: `[Synced] ${data.source}`, lang: "ara" }] };

    } catch (e) { 
        console.error(`[CRITICAL ERROR] حدث خطأ غير متوقع: ${e.message}`);
    }
    
    return { subtitles: [] };
});

module.exports = builder.getInterface();