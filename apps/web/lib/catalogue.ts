// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

// Popular-items catalogue for "Start from popular items" (FDD wardrobe, FR-24).
//
// Photos and the manifest are LOCAL ONLY. They come from the H&M Kaggle
// competition data, whose rules allow non-commercial academic use but forbid
// redistribution, so public/catalogue/ is git-ignored (see data/media/README.md).
// Without a manifest the grid renders tinted placeholder tiles from SAMPLE below,
// so a fresh clone still works. The loader is in catalogue.server.ts so this file
// stays importable from client components.

export type CatalogueItem = {
  id: string;
  name: string;
  /** Family such as "Shirts", "Shoes", "Accessories". */
  group: string;
  /** Hex of the item's main colour; tints the tile (FR-24). */
  colour: string;
  colourName: string;
  /** File name under public/catalogue/img/, when a local photo exists. */
  image?: string;
  /** Demo values: the pilot has no price feed. */
  price: number;
  mrp: number;
  rating?: number;
  ratingCount?: number;
  swatches?: string[];
};

export const SAMPLE: CatalogueItem[] = [
  {
    id: "s1",
    name: "Oxford button-down shirt, regular fit",
    group: "Shirts",
    colour: "#6f95c8",
    colourName: "Blue",
    price: 1299,
    mrp: 1999,
    rating: 4.3,
    ratingCount: 2800,
    swatches: ["#6f95c8", "#f1ede4", "#2b2f3a"],
  },
  {
    id: "s2",
    name: "Straight chinos, stretch cotton",
    group: "Trousers",
    colour: "#b8a07e",
    colourName: "Khaki",
    price: 1499,
    mrp: 2499,
    rating: 4.1,
    ratingCount: 1900,
    swatches: ["#b8a07e", "#2b2f3a"],
  },
  {
    id: "s3",
    name: "White leather low-top sneakers",
    group: "Shoes",
    colour: "#ecebe6",
    colourName: "White",
    price: 2799,
    mrp: 4999,
    rating: 4.4,
    ratingCount: 5400,
  },
  {
    id: "s4",
    name: "Merino crew-neck jumper",
    group: "Knitwear",
    colour: "#7d3b46",
    colourName: "Burgundy",
    price: 1899,
    mrp: 2999,
    rating: 4.2,
    ratingCount: 960,
    swatches: ["#7d3b46", "#3d4a3f"],
  },
  {
    id: "s5",
    name: "Slim indigo jeans",
    group: "Trousers",
    colour: "#30415f",
    colourName: "Indigo",
    price: 1699,
    mrp: 2799,
    rating: 4.3,
    ratingCount: 7100,
  },
  {
    id: "s6",
    name: "Cotton kurta, band collar",
    group: "Ethnic",
    colour: "#e6d9b8",
    colourName: "Ecru",
    price: 999,
    mrp: 1799,
    rating: 4.0,
    ratingCount: 3300,
    swatches: ["#e6d9b8", "#3d4a3f", "#c9663a"],
  },
  {
    id: "s7",
    name: "Canvas belt, brushed buckle",
    group: "Accessories",
    colour: "#3a3a3f",
    colourName: "Charcoal",
    price: 399,
    mrp: 799,
    rating: 4.1,
    ratingCount: 640,
  },
  {
    id: "s8",
    name: "Aviator sunglasses, polarised",
    group: "Accessories",
    colour: "#c9a24a",
    colourName: "Gold",
    price: 699,
    mrp: 1499,
    rating: 4.0,
    ratingCount: 2200,
  },
  {
    id: "s9",
    name: "Quilted bomber jacket",
    group: "Outerwear",
    colour: "#3d4a3f",
    colourName: "Olive",
    price: 2599,
    mrp: 4299,
    rating: 4.4,
    ratingCount: 1500,
  },
  {
    id: "s10",
    name: "Linen shirt, short sleeve",
    group: "Shirts",
    colour: "#d9c9a8",
    colourName: "Sand",
    price: 1099,
    mrp: 1699,
    rating: 4.2,
    ratingCount: 880,
    swatches: ["#d9c9a8", "#6f95c8"],
  },
  {
    id: "s11",
    name: "Leather loafers",
    group: "Shoes",
    colour: "#5a3a26",
    colourName: "Brown",
    price: 3299,
    mrp: 5499,
    rating: 4.5,
    ratingCount: 1200,
  },
  {
    id: "s12",
    name: "Wool-blend scarf",
    group: "Accessories",
    colour: "#a63a3a",
    colourName: "Red",
    price: 599,
    mrp: 1199,
    rating: 4.1,
    ratingCount: 410,
  },
];

export const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
export const discount = (i: CatalogueItem) => Math.round(((i.mrp - i.price) / i.mrp) * 100);
