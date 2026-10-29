import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, Loader2, Image as ImageIcon, Film, Plus, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { r2Storage } from '../lib/storage';
import { askAI } from '../lib/ai';

interface MediaItem {
  url: string;
  color?: string;
  alt?: string;
}

interface MediaManagerProps {
  images: MediaItem[];
  videos: MediaItem[];
  colors: { name: string; code: string }[];
  onImagesChange: (images: MediaItem[]) => void;
  onVideosChange: (videos: MediaItem[]) => void;
  productName?: string;
}

const MediaManager: React.FC<MediaManagerProps> = ({ images, videos, colors, onImagesChange, onVideosChange, productName }) => {
  const [uploading, setUploading] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [improvingAltIndex, setImprovingAltIndex] = useState<number | null>(null);

  const convertToWebP = (file: File): Promise<File> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject('Canvas context not available');
          const MAX_WIDTH = 1200;
          let width = img.width;
          let height = img.height;
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
            if (!blob) return reject('Blob conversion failed');
            const webpFile = new File([blob], file.name.replace(/\.[^/.]+$/, ".webp"), {
              type: 'image/webp',
              lastModified: Date.now(),
            });
            resolve(webpFile);
          }, 'image/webp', 0.82);
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const slugify = (text: string) => {
    return text
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    setUploading(true);
    setError(null);
    const newImages: MediaItem[] = [];

    try {
      let index = images.length + 1;
      for (let file of acceptedFiles) {
        // Optimization: Convert to WebP
        if (file.type !== 'image/webp' || file.size > 500 * 1024) {
          try {
            file = await convertToWebP(file);
          } catch (webpErr) {
            console.warn('WebP conversion failed:', webpErr);
          }
        }

        // Descriptive Naming
        const baseName = productName ? slugify(productName) : 'producto';
        const customName = `${baseName}-${index++}`;

        const { url, error: uploadError } = await r2Storage.uploadFile(file, 'products', customName);

        if (uploadError) throw uploadError;

        if (url) {
          newImages.push({ url });
        }
      }

      onImagesChange([...images, ...newImages]);
    } catch (err: any) {
      console.error('Error uploading image:', err);
      setError('Error al subir imagen(es). Intenta de nuevo.');
    } finally {
      setUploading(false);
    }
  }, [images, onImagesChange, productName]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.webp']
    },
    multiple: true
  } as any);

  const removeImage = async (index: number) => {
    const imageToDelete = images[index];
    if (imageToDelete && imageToDelete.url) {
      await r2Storage.deleteFile(imageToDelete.url);
    }
    const newImages = [...images];
    newImages.splice(index, 1);
    onImagesChange(newImages);
  };

  const updateImageColor = (index: number, color: string) => {
    const newImages = [...images];
    newImages[index].color = color;
    onImagesChange(newImages);
  };

  const addVideo = () => {
    if (videoUrl) {
      onVideosChange([...videos, { url: videoUrl }]);
      setVideoUrl('');
    }
  };

  const updateImageAlt = (index: number, alt: string) => {
    const newImages = [...images];
    newImages[index].alt = alt;
    onImagesChange(newImages);
  };

  const handleSuggestAltWithAI = async (index: number) => {
    if (!productName) {
      alert('Se requiere el nombre del producto para generar un texto alternativo preciso.');
      return;
    }

    setImprovingAltIndex(index);
    try {
      const prompt = `Genera un texto alternativo (ALT text) breve, descriptivo y optimizado para SEO para una imagen de un producto llamado "${productName}". El texto debe describir visualmente la prenda para Google Imágenes y accesibilidad. Max 120 caracteres. Solo devuelve el texto, nada más.`;
      const suggestedAlt = await askAI([{ role: 'user', content: prompt }], { temperature: 0.7 });

      if (suggestedAlt) {
        updateImageAlt(index, suggestedAlt.replace(/"/g, ''));
      }
    } catch (err: any) {
      console.error('AI Alt suggestion error:', err);
      alert('Error al generar sugerencia: ' + err.message);
    } finally {
      setImprovingAltIndex(null);
    }
  };

  const removeVideo = async (index: number) => {
    const videoToDelete = videos[index];
    if (videoToDelete && videoToDelete.url) {
      // Only delete if it's a Cloudflare URL (not YouTube/external)
      if (videoToDelete.url.includes(import.meta.env.VITE_CLOUDFLARE_PUBLIC_URL)) {
        await r2Storage.deleteFile(videoToDelete.url);
      }
    }
    const newVideos = [...videos];
    newVideos.splice(index, 1);
    onVideosChange(newVideos);
  };

  const updateVideoColor = (index: number, color: string) => {
    const newVideos = [...videos];
    newVideos[index].color = color;
    onVideosChange(newVideos);
  };

  return (
    <div className="space-y-8">
      {/* Images Section */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <label className="block text-sm font-semibold text-gray-900 flex items-center">
            <ImageIcon className="w-4 h-4 mr-2" /> Galería de Imágenes
          </label>
          <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400 bg-gray-100 px-2 py-1 rounded">
            Drag & Drop activo
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
          {images.map((img, index) => (
            <div key={index} className="relative group bg-white rounded-lg overflow-hidden border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="aspect-square relative">
                <img src={img.url} alt={`Product ${index}`} className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeImage(index)}
                  className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow-lg"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="p-2 space-y-2 bg-white">
                <select
                  value={img.color || ''}
                  onChange={(e) => updateImageColor(index, e.target.value)}
                  className="w-full text-[10px] border-gray-100 rounded-md focus:ring-0 focus:border-vandora-emerald p-1 bg-gray-50 font-medium text-gray-700"
                >
                  <option value="">Cualquier color</option>
                  {colors.map(c => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
                
                <div className="relative group/alt">
                  <input
                    type="text"
                    placeholder="Texto ALT (SEO)"
                    value={img.alt || ''}
                    onChange={(e) => updateImageAlt(index, e.target.value)}
                    className="w-full text-[10px] border-gray-100 rounded-md focus:ring-0 focus:border-vandora-emerald p-1 bg-gray-50 pr-6"
                  />
                  <button
                    type="button"
                    onClick={() => handleSuggestAltWithAI(index)}
                    disabled={improvingAltIndex === index}
                    className="absolute right-1 top-1 text-vandora-emerald hover:text-emerald-800 disabled:opacity-50"
                    title="Sugerir con IA"
                  >
                    {improvingAltIndex === index ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            </div>
          ))}

          <div
            {...getRootProps()}
            className={`aspect-square border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-all ${isDragActive ? 'border-vandora-emerald bg-emerald-50 scale-95' : 'border-gray-200 hover:border-vandora-emerald hover:bg-gray-50'
              }`}
          >
            <input {...getInputProps()} />
            {uploading ? (
              <Loader2 className="h-6 w-6 animate-spin text-vandora-emerald" />
            ) : (
              <>
                <div className="bg-gray-100 p-2 rounded-full mb-2">
                  <Plus className="h-5 w-5 text-gray-400" />
                </div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tight text-center px-1">Subir Fotos</span>
              </>
            )}
          </div>
        </div>
        {error && <p className="text-xs text-red-600 mt-2 font-medium bg-red-50 p-2 rounded border border-red-100">{error}</p>}
      </div>

      {/* Videos Section */}
      <div className="border-t pt-6 border-gray-100">
        <label className="block text-sm font-semibold text-gray-900 mb-4 flex items-center">
          <Film className="w-4 h-4 mr-2" /> Videos del Producto
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {videos.map((vid, index) => (
            <div key={index} className="flex flex-col bg-white border border-gray-200 rounded-lg p-3 shadow-sm group">
              <div className="flex items-center space-x-3 mb-2">
                <div className="p-2 bg-emerald-50 rounded text-vandora-emerald">
                  <Film className="h-4 w-4" />
                </div>
                <span className="text-xs text-gray-600 flex-1 truncate font-medium">{vid.url}</span>
                <button
                  type="button"
                  onClick={() => removeVideo(index)}
                  className="text-gray-300 hover:text-red-500 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center justify-between border-t border-gray-50 pt-2">
                <span className="text-[10px] font-bold text-gray-400 uppercase">Mostrar para el color:</span>
                <select
                  value={vid.color || ''}
                  onChange={(e) => updateVideoColor(index, e.target.value)}
                  className="text-[11px] border-none rounded-md focus:ring-0 p-1 bg-gray-50 font-semibold text-gray-700 max-w-[120px]"
                >
                  <option value="">Cualquier color</option>
                  {colors.map(c => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>

        <div className="flex space-x-2 bg-gray-50 p-2 rounded-lg border border-gray-200">
          <input
            type="url"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="URL del video (YouTube, MP4...)"
            className="flex-1 rounded-md border-gray-300 shadow-sm border p-2 text-sm focus:ring-1 focus:ring-vandora-emerald outline-none"
          />
          <button
            type="button"
            onClick={addVideo}
            className="px-4 py-2 bg-vandora-emerald text-white rounded-md hover:bg-emerald-800 shadow-sm transition-colors"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default MediaManager;
