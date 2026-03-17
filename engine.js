const scraper = require('./scraper');
const mongoose = require('mongoose');

// تعريف الـ Schema لضمان عدم حدوث MissingSchemaError
const SubtitleSchema = new mongoose.Schema({
    fileId: { type: String, unique: true },
    imdbId: String,
    arabicText: String,
    label: String,
    isAI: { type: Boolean, default: false },
    createdAt: { type: Date, expires: '15d', default: Date.now }
});

const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', SubtitleSchema);

/**
 * وظيفة جلب الترجمات المزامنة
 * @param {string} imdbId - معرف الفيلم أو المسلسل
 * @param {string} videoFileName - اسم ملف الفيديو المشغل حالياً (للمطابقة)
 */
async function getSyncedSubtitles(imdbId, videoFileName) {
    console.log(`\n[ENGINE] 🎯 جاري البحث عن أفضل مطابقة لـ: ${videoFileName}`);
    
    try {
        // 1. البحث في الكاش أولاً
        const cachedSubs = await Subtitle.find({ imdbId: imdbId });
        
        if (cachedSubs && cachedSubs.length > 0) {
            console.log(`[ENGINE-CACHE] 📦 تم العثور على ${cachedSubs.length} ملفات مخزنة.`);
            return cachedSubs.map(sub => ({
                fileId: sub.fileId,
                label: sub.label,
                isAI: sub.isAI,
                // فحص المطابقة مع الملف الحالي لتمييزها بنجمة ⭐
                isMatch: (videoFileName || "").toLowerCase().includes((sub.label || "").toLowerCase().split('.')[0])
            }));
        }

        // 2. إذا لم يوجد كاش، نطلب من السكرابر البحث "بشكل مطابق"
        console.log(`[ENGINE-REMOTE] 🌐 جاري البحث الخارجي والترجمة الذكية...`);
        const allSubs = await scraper.fetchAllPossibleSubs(imdbId, videoFileName);
        
        if (!allSubs || allSubs.length === 0) {
            console.log(`[ENGINE-EMPTY] ⚠️ لا توجد نتائج مطابقة نهائياً.`);
            return [];
        }

        let results = [];
        for (let i = 0; i < allSubs.length; i++) {
            const sub = allSubs[i];
            // تنظيف الـ ID ليكون صالحاً كـ URL
            const cleanId = imdbId.replace(/:/g, '_');
            const fileId = `${cleanId}_v${i + 1}_smart`;

            // تحديد هل هذه النسخة هي الأنسب للمستخدم حالياً؟
            const isMatch = (videoFileName || "").toLowerCase().includes((sub.releaseName || "").toLowerCase().split('.')[0]);

            console.log(`[ENGINE-SAVE] 💾 حفظ: ${sub.releaseName} | AI: ${sub.source === "AI"}`);
            
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
            
            results.push({ 
                fileId, 
                label: sub.releaseName, 
                isMatch, 
                isAI: sub.source === "AI" 
            });
        }
        
        // ترتيب النتائج بحيث تظهر النسخة المطابقة في الأعلى
        return results.sort((a, b) => b.isMatch - a.isMatch);

    } catch (e) {
        console.error(`[ENGINE-CRITICAL] ❌ فشل في المحرك: ${e.message}`);
        return [];
    }
}

module.exports = { getSyncedSubtitles };
