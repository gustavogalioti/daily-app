const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const USE_CLOUDINARY = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY    &&
  process.env.CLOUDINARY_API_SECRET
);

if (USE_CLOUDINARY) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  console.log('   ☁️  Cloudinary ativo');
} else {
  console.log('   📁 Uploads locais');
}

function createPhotoUpload() {
  if (USE_CLOUDINARY) {
    const storage = new CloudinaryStorage({
      cloudinary,
      params: async (req, file) => ({
        folder: 'daily/posts',
        allowed_formats: ['jpg','jpeg','png','webp','gif'],
        transformation: [{ width: 1200, quality: 'auto', fetch_format: 'auto' }]
      })
    });
    return multer({ storage, limits: { fileSize: 10*1024*1024 } });
  }
  const dir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => { const { v4 } = require('uuid'); cb(null, `${v4()}${path.extname(file.originalname).toLowerCase()}`); }
  });
  return multer({ storage, limits: { fileSize: 10*1024*1024 },
    fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null,true) : cb(new Error('Apenas imagens')) });
}

function createAvatarUpload(userId) {
  if (USE_CLOUDINARY) {
    const storage = new CloudinaryStorage({
      cloudinary,
      params: async (req, file) => ({
        folder: 'daily/avatars',
        public_id: `avatar_${userId}`,
        allowed_formats: ['jpg','jpeg','png','webp'],
        transformation: [{ width: 400, height: 400, crop: 'fill', quality: 'auto' }]
      })
    });
    return multer({ storage, limits: { fileSize: 5*1024*1024 } });
  }
  const dir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => cb(null, `avatar_${userId}${path.extname(file.originalname).toLowerCase()}`)
  });
  return multer({ storage, limits: { fileSize: 5*1024*1024 } });
}

function getUploadedUrl(req, file) {
  if (!file) return null;
  if (USE_CLOUDINARY) return file.path;
  return `/uploads/${file.filename}`;
}

// Upload de imagem base64 diretamente (para DailyPoke avatar)
async function uploadBase64Image(dataUrl, folder = 'daily/poke_avatars') {
  if (USE_CLOUDINARY) {
    const result = await cloudinary.uploader.upload(dataUrl, {
      folder,
      format: 'png',
      transformation: [{ width: 200, height: 320, crop: 'fit' }]
    });
    return result.secure_url;
  }
  // Fallback local: salvar como arquivo
  const { v4: uuidv4 } = require('uuid');
  const dir = require('path').join(__dirname, 'uploads', 'poke_avatars');
  if (!require('fs').existsSync(dir)) require('fs').mkdirSync(dir, { recursive: true });
  const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
  const filename = `poke_${uuidv4()}.png`;
  require('fs').writeFileSync(require('path').join(dir, filename), base64Data, 'base64');
  return `/uploads/poke_avatars/${filename}`;
}

module.exports = { createPhotoUpload, createAvatarUpload, getUploadedUrl, USE_CLOUDINARY, uploadBase64Image };
