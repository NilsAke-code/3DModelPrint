import { useEffect, useRef } from 'react';
import type { Model3D } from '../types';
import { getModelFileUrl } from '../services/api';
import { generateModelGalleryFromUrl } from '../utils/generateThumbnail';
import { uploadSeedModelImages } from '../services/api';

interface Props {
  models: Model3D[];
  onRefresh: () => void;
}

/**
 * Silently generates proper 3D-rendered thumbnails (Tinkercad-style) for
 * seed models that only have a server-side placeholder PNG.
 * Processes one model at a time to avoid GPU exhaustion.
 */
export default function ThumbnailAutoGen({ models, onRefresh }: Props) {
  const runningRef = useRef(false);

  useEffect(() => {
    if (runningRef.current || models.length === 0) return;

    // Models that only have the seeder's placeholder PNG (single .png image)
    const needsRegen = models.filter(
      (m) =>
        m.images?.length === 1 &&
        m.images[0].imagePath.endsWith('.png'),
    );

    if (needsRegen.length === 0) return;

    runningRef.current = true;

    (async () => {
      let didGenerate = false;

      for (const model of needsRegen) {
        const stlUrl = getModelFileUrl(model);
        if (!stlUrl) continue;

        try {
          const blobs = await generateModelGalleryFromUrl(stlUrl);
          if (blobs.length === 0) continue;

          const [cover, ...gallery] = blobs;
          await uploadSeedModelImages(model.id, cover, gallery);
          didGenerate = true;
        } catch (err) {
          // Non-fatal — just skip this model
          console.warn(`ThumbnailAutoGen: skipped model ${model.id}`, err);
        }
      }

      runningRef.current = false;
      if (didGenerate) onRefresh();
    })();
  }, [models, onRefresh]);

  return null;
}
