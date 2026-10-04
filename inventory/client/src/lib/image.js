/**
 * הקטנת תמונה בדפדפן לפני העלאה.
 * צילום מהטלפון הוא 4-12MB. לקריאת כתב יד מספיקים ~1600px על הצד הארוך,
 * וזה חוסך זמן העלאה בקליטה חלשה וגם עלות על כל דף.
 */

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

/** טוען קובץ תמונה לאלמנט img. מטפל גם ב-HEIC שהדפדפן לא יודע לפתוח */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('לא ניתן לקרוא את התמונה. נסה לצלם שוב או לבחור JPEG'));
    };
    img.src = url;
  });
}

/**
 * מחזיר Blob של JPEG מוקטן. אם התמונה כבר קטנה - עדיין מקודד מחדש ל-JPEG,
 * כדי שהשרת יקבל פורמט אחיד.
 */
export async function shrinkImage(file) {
  const img = await loadImage(file);

  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  context.drawImage(img, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('הקטנת התמונה נכשלה'))),
      'image/jpeg',
      JPEG_QUALITY
    );
  });
}
