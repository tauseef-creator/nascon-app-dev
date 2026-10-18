import { Image } from 'expo-image';
import React, { useState } from 'react';
import { Product } from '../api/types';
import { getBaseUrl } from '../api/client';

// Generic fallback shown while an image loads, when a product has no image, or when it fails to load.
const PLACEHOLDER = require('../../assets/product-placeholder.jpg');

type Props = {
  product: Pick<Product, 'product_id'> & { image_url?: string | null };
  height: number;
};

/** Product image from the API (`image_url`), cached on disk so it also shows offline. */
export function ProductArt({ product, height }: Props) {
  const [failed, setFailed] = useState(false);
  const url = product.image_url && !failed
    ? (/^https?:\/\//.test(product.image_url) ? product.image_url : getBaseUrl() + product.image_url)
    : null;
  return (
    <Image
      source={url ? { uri: url } : PLACEHOLDER}
      placeholder={PLACEHOLDER}
      placeholderContentFit="cover"
      cachePolicy="memory-disk"
      transition={150}
      onError={() => setFailed(true)}
      style={{ width: '100%', height }}
      contentFit="cover"
    />
  );
}
