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
      params: { folder: 'daily/posts', allowed_formats: ['jpg','jpeg','png','webp','gif'],
                transformation: [{ width: 1200, quality: 'auto', fetch_format: 'auto' }] }
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
      params: { folder: 'daily/avatars', public_id: `avatar_${userId}`,
                allowed_formats: ['jpg','jpeg','png','webp'],
                transformation: [{ width: 400, height: 400, crop: 'fill', quality: 'auto' }] }
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

module.exports = { createPhotoUpload, createAvatarUpload, getUploadedUrl, USE_CLOUDINARY };
