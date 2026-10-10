'use client';

import { useEffect, useRef, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Dialog, DialogContent, DialogTitle } from '@/shared/components/ui/dialog';
import { toast } from 'sonner';

export async function cropAvatar(source: string, area: Area): Promise<Blob> {
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image editing is unavailable in this browser.');
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, 512, 512);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to crop image.')), 'image/webp', 0.82));
}

export function AvatarCropDialog({ file, onClose, onApply }: { file: File; onClose: () => void; onApply: (blob: Blob) => Promise<void> }) {
  const [source, setSource] = useState('');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const apply = async () => {
    if (!area || busy.current) return;
    busy.current = true;
    setSaving(true);
    try { await onApply(await cropAvatar(source, area)); onClose(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to save profile image.'); }
    finally { busy.current = false; setSaving(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy.current) onClose(); }}>
    <DialogContent aria-label="Crop profile picture" className="w-[calc(100vw-2rem)] max-w-md max-h-[90dvh] overflow-y-auto space-y-4">
      <DialogTitle>Crop profile picture</DialogTitle>
      <p className="text-sm text-slate-500">Drag to reposition. The square preview will be saved.</p>
      <div className={`relative w-full h-64 sm:h-80 overflow-hidden bg-slate-900 rounded-lg ${saving ? 'pointer-events-none' : ''}`}>
        {source && <Cropper image={source} crop={crop} zoom={zoom} aspect={1} onCropChange={setCrop} onZoomChange={setZoom}
          onCropComplete={(_, pixels) => setArea(pixels)}
          onInteractionStart={() => setArea(null)} />}
      </div>
      <label className="flex items-center gap-3 text-sm">Zoom
        <input aria-label="Zoom" type="range" min={1} max={3} step={0.05} value={zoom} disabled={saving} onChange={event => setZoom(Number(event.target.value))} className="flex-1" />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" disabled={saving} onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
        <button type="button" disabled={saving || !area} onClick={apply} className="rounded-lg bg-primary text-white px-4 py-2 text-sm disabled:opacity-50">{saving ? 'Uploading…' : 'Apply picture'}</button>
      </div>
    </DialogContent>
  </Dialog>;
}
