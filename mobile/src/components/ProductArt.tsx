import { Image } from 'expo-image';
import React from 'react';
import { Product } from '../api/types';
import { JerseyArt } from './JerseyArt';

const SCARF = require('../../assets/demo-scarf.png');
const BOTTLE = require('../../assets/demo-bottle.png');
const FALLBACK = require('../../assets/merch.jpg');

/** Bundled merchandise photos work without a network connection. */
export function ProductArt({ product, height }: { product: Product; height: number }) {
  if (product.category === 'apparel') return <JerseyArt name={product.name} height={height} />;
  const source = product.product_id === 'demo-prod-united-scarf' ? SCARF
    : product.product_id === 'demo-prod-training-bottle' ? BOTTLE
      : FALLBACK;
  return <Image source={source} style={{ width: '100%', height }} contentFit="cover" />;
}
