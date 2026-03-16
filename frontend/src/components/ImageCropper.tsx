"use client";

import { useState, useRef, useCallback } from "react";
import ReactCrop, { type Crop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

export interface CropBounds {
  x_pct: number;
  y_pct: number;
  w_pct: number;
  h_pct: number;
}

interface ImageCropperProps {
  imageSrc: string;
  onCropDone: (croppedFile: File) => void;
  onCancel: () => void;
  /** Pre-detected crop region in percentage (0-100). Falls back to 80% centered. */
  initialCrop?: CropBounds;
}

/**
 * Full-screen image cropper overlay.
 * Drag edges/corners to select a region, then confirm to crop.
 */
export function ImageCropper({ imageSrc, onCropDone, onCancel, initialCrop }: ImageCropperProps) {
  const t = useTranslations("imageCropper");
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    imgRef.current = e.currentTarget;
    const { width, height } = e.currentTarget;

    if (initialCrop) {
      // Use backend-detected bounds (percentage → pixel)
      const x = (initialCrop.x_pct / 100) * width;
      const y = (initialCrop.y_pct / 100) * height;
      const w = (initialCrop.w_pct / 100) * width;
      const h = (initialCrop.h_pct / 100) * height;
      setCrop({ unit: "px", x, y, width: w, height: h });
    } else {
      // Default crop: 80% centered
      const x = width * 0.1;
      const y = height * 0.1;
      const w = width * 0.8;
      const h = height * 0.8;
      setCrop({ unit: "px", x, y, width: w, height: h });
    }
  }, [initialCrop]);

  const handleConfirm = () => {
    const img = imgRef.current;
    if (!img || !completedCrop) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Scale from displayed size to natural size
    const scaleX = img.naturalWidth / img.width;
    const scaleY = img.naturalHeight / img.height;

    const cropX = completedCrop.x * scaleX;
    const cropY = completedCrop.y * scaleY;
    const cropW = completedCrop.width * scaleX;
    const cropH = completedCrop.height * scaleY;

    canvas.width = cropW;
    canvas.height = cropH;
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], "cropped.jpg", { type: "image/jpeg" });
        onCropDone(file);
      },
      "image/jpeg",
      0.9,
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      {/* Crop area */}
      <div className="flex flex-1 items-center justify-center overflow-auto p-2">
        <ReactCrop
          crop={crop}
          onChange={(c) => setCrop(c)}
          onComplete={(c) => setCompletedCrop(c)}
        >
          <img
            src={imageSrc}
            alt="crop"
            onLoad={onImageLoad}
            style={{ maxHeight: "calc(100dvh - 80px)", maxWidth: "100%" }}
          />
        </ReactCrop>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between bg-black/80 px-4 py-3 safe-area-bottom">
        <Button
          variant="ghost"
          onClick={onCancel}
          className="border border-white/40 text-white hover:bg-white/20 hover:text-white"
        >
          {t("cancel")}
        </Button>

        <span className="text-xs text-white/60">
          {t("dragHint")}
        </span>

        <Button
          onClick={handleConfirm}
          disabled={!completedCrop}
          className="bg-white text-black hover:bg-white/90"
        >
          {t("done")}
        </Button>
      </div>
    </div>
  );
}
