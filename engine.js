const scraper = require('./scraper');
const mongoose = require('mongoose');

// 1. تعريف الـ Schema فوراً داخل الملف لضمان استقرار الموديل
const SubtitleSchema = new mongoose.Schema({
    fileId: { type: String, unique: true },
    imdbId: String,
    arabicText: String,
    label: String,
    isAI: { type: Boolean, default: false },
    createdAt: { type: Date, expires: '15d', default: Date.now }
});

// 2. محاولة جلب الموديل إذا كان مسجلاً، وإذا لم يكن، نقوم بتسجيله فوراً
const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', SubtitleSchema);

async function getSyncedSubtitles(imdbId, videoFileName) {
    console.log(`\n[ENGINE-LOG] 🧐 فحص المخزون لـ: ${imdbId}`);
    
    try {
        const cachedSubs = await Subtitle.find({ imdbId: imdbId });
        
        if (cachedSubs && cachedSubs.length > 0) {
            console.log(`[ENGINE-CACHE] 📦 وجدنا ${cachedSubs.length} ملفات في الكاش. يتم التحقق من المطابقة...`);
            return cachedSubs.map(sub => ({
                fileId: sub.fileId,
                label: sub.label,
                isAI: sub.isAI,
                isMatch: (videoFileName || "").toLowerCase().includes((sub.label || "").toLowerCase())
            }));
        }

        console.log(`[ENGINE-SEARCH] 🌐 الكاش فارغ. جاري جلب ترجمات من المصدر الخارجي...`);
        const allSubs = await scraper.fetchAllPossibleSubs(imdbId);
        
        if (!allSubs || allSubs.length === 0) {
            console.log(`[ENGINE-EMPTY] ⚠️ لم يتم العثور على أي نتائج لهذا المحتوى.`);
            return [];
        }

        let results = [];
        for (let i = 0; i < allSubs.length; i++) {
            const sub = allSubs[i];
            const fileId = `${imdbId.replace(/:/g, '_')}_v${i + 1}_smart`;

            const videoLower = (videoFileName || "").toLowerCase();
            const releaseKeywords = (sub.releaseName || "").toLowerCase().split(/[\s.-]+/);
            const isMatch = videoLower && releaseKeywords.some(kw => kw.length > 3 && videoLower.includes(kw));

            console.log(`[ENGINE-SAVE] 💾 حفظ ومعالجة: ${sub.releaseName} (AI: ${sub.source === "AI"})`);
            
            await Subtitle.findOneAndUpdate(
                { fileId: fileId },
                { 
                    imdbId: imdbId, 
                    arabicText: sub.content, 
                    label: sub.releaseName,
                    isAI: sub.source === "AI"
                },
                { upsert: true, new: true }
            );
            
            results.push({ fileId, label: sub.releaseName, isMatch, isAI: sub.source === "AI" });
        }
        
        return results.sort((a, b) => b.isMatch - a.isMatch);
    } catch (e) {
        console.error(`[ENGINE-CRITICAL] ❌ خطأ أثناء معالجة المحرك: ${e.message}`);
        return [];
    }
}

module.exports = { getSyncedSubtitles };
