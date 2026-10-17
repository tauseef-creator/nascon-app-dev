import { Image } from 'expo-image';
import React from 'react';
import { Product } from '../api/types';

const UNITED_JERSEY = require('../../assets/demo-united-jersey.png');
const ROVERS_JERSEY = require('../../assets/demo-rovers-jersey.png');
const SCARF = require('../../assets/demo-scarf.png');
const BOTTLE = require('../../assets/demo-bottle.png');
const FALLBACK = require('../../assets/merch.jpg');

/** Bundled merchandise photos work without a network connection. */
export function ProductArt({ product, height }: { product: Pick<Product, 'product_id'>; height: number }) {
  const source = product.product_id === 'prod-jersey-001' ? UNITED_JERSEY
    : product.product_id === 'demo-prod-rovers-jersey' ? ROVERS_JERSEY
    : product.product_id === 'demo-prod-united-scarf' ? SCARF
    : product.product_id === 'demo-prod-training-bottle' ? BOTTLE
      : FALLBACK;
  return <Image source={source} style={{ width: '100%', height }} contentFit="cover" />;
}
