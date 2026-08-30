#!/usr/bin/env node
// Regenera el catálogo de la tienda desde la web oficial del proveedor.
//
//   node scripts/sync-mukhair.mjs
//
// Lee la Store API pública de mukhairperu.com (WooCommerce), escribe
// assets/mukhair.js y descarga las imágenes a assets/productos/. Correrlo
// cuando el proveedor cambie precios o agregue productos.

import { writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://www.mukhairperu.com/pe/wp-json/wc/store/v1/products?per_page=100";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36";

const LINEAS = ["MUK SPA", "mr. muk", "Deep", "Intense", "Fat", "Kinky", "Head", "Hot", "Blonde",
  "Vivid", "Hard", "Raw", "Rough", "Dry", "Filthy", "Slick", "Savage", "Beach"];
const MENORES = new Set(["de", "del", "la", "el", "y", "en", "con", "para", "sin", "a", "al", "o", "los", "las", "por"]);

const limpiar = (html) =>
  (html || "").replace(/<li>/g, "• ").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&(l|r)dquo;/g, '"').replace(/&(l|r)squo;/g, "'")
    .replace(/\s+/g, " ").trim();

// El proveedor publica los nombres en MAYÚSCULAS; se pasan a capitalización
// normal para que la vitrina no grite.
function formatearNombre(nombre) {
  const limpio = nombre.replace(/\s*\|\s*/g, " ").trim();
  const letras = [...limpio].filter((c) => /\p{L}/u.test(c));
  const ratio = letras.filter((c) => c === c.toUpperCase()).length / Math.max(1, letras.length);
  if (ratio <= 0.8) return limpio;
  return limpio.split(" ").map((palabra, i) => {
    const min = palabra.toLowerCase();
    if (min === "muk" || min === "spa") return palabra.toUpperCase();
    if (/^\d/.test(min)) return min;
    if (MENORES.has(min) && i > 0) return min;
    return palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase();
  }).join(" ").replace(/\bMuk\b/g, "MUK").replace(/^Mr\. MUK/, "mr. muk");
}

function etiquetas(nombresCategorias, enOferta) {
  const tags = new Set();
  if (nombresCategorias.includes("Shampoos & Acondicionadores")) tags.add("shampoos");
  if (nombresCategorias.includes("Tratamientos")) tags.add("tratamientos");
  if (nombresCategorias.includes("ESTILISMO")) tags.add("estilismo");
  if (nombresCategorias.includes("CUIDADO DEL HOMBRE") || nombresCategorias.includes("mr. muk")) tags.add("hombre");
  if (["Dúos", "Tríos", "Dúos de Verano"].some((c) => nombresCategorias.includes(c))) tags.add("packs");
  if (enOferta) tags.add("ofertas");
  if (!tags.size) tags.add("estilismo");
  return [...tags].sort();
}

const res = await fetch(API, { headers: { "User-Agent": UA } });
if (!res.ok) throw new Error(`La API del proveedor respondió ${res.status}`);
const crudos = await res.json();
console.log(`Proveedor: ${crudos.length} productos`);

await mkdir(join(RAIZ, "assets/productos"), { recursive: true });
const usados = new Set();
const productos = [];

for (const p of crudos) {
  const cats = p.categories.map((c) => limpiar(c.name));
  const precio = Number(p.prices.price) / 100;
  const lista = Number(p.prices.regular_price) / 100;
  const imagen = p.images?.[0];
  let archivo = null;
  if (imagen) {
    const url = imagen.thumbnail || imagen.src;
    const ext = (url.split("?")[0].match(/\.[a-z0-9]+$/i) || [".jpg"])[0];
    archivo = `${p.slug}${ext}`;
    const bin = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://www.mukhairperu.com/pe/tienda/" } });
    if (bin.ok) {
      await writeFile(join(RAIZ, "assets/productos", archivo), Buffer.from(await bin.arrayBuffer()));
      usados.add(archivo);
    } else {
      console.warn(`  imagen falló (${bin.status}): ${p.slug}`);
      archivo = null;
    }
  }
  productos.push({
    id: String(p.id),
    slug: p.slug,
    nombre: formatearNombre(limpiar(p.name)),
    linea: LINEAS.find((l) => cats.includes(l)) || "muk",
    precio, precio_lista: lista, oferta: precio < lista,
    tags: etiquetas(cats, precio < lista),
    img: archivo ? `assets/productos/${archivo}` : "",
    desc: limpiar(p.short_description).slice(0, 600),
    url: p.permalink
  });
}

// Imágenes de productos que el proveedor ya no lista.
for (const f of await readdir(join(RAIZ, "assets/productos"))) {
  if (!usados.has(f)) { await unlink(join(RAIZ, "assets/productos", f)); console.log(`  eliminada ${f}`); }
}

// Las ceras/barros/gominas de peinado (potes individuales de "Cuidado del
// hombre") son lo primero que la barbería quiere mostrar en la vitrina —
// van antes que los dúos/tríos/ofertas en combo, que igual siguen listados.
const esCeraDePeinado = (p) => p.tags.includes("hombre") && p.tags.includes("estilismo") && !p.tags.includes("packs");
productos.sort((a, b) => Number(esCeraDePeinado(b)) - Number(esCeraDePeinado(a)));

const cabecera = `// Catálogo MUK Hair Perú — Cieza Barber Studio es distribuidor autorizado.
// Generado por scripts/sync-mukhair.mjs desde la tienda oficial del proveedor.
// No editar a mano: correr el script cuando cambien precios o productos.
var MUK_FILTROS = [
  { id: "todos", label: "Todos" },
  { id: "shampoos", label: "Shampoos & acondicionadores" },
  { id: "tratamientos", label: "Tratamientos" },
  { id: "estilismo", label: "Estilismo" },
  { id: "hombre", label: "Cuidado del hombre" },
  { id: "packs", label: "Dúos & tríos" },
  { id: "ofertas", label: "Ofertas" }
];

var MUK_PRODUCTOS = `;

await writeFile(join(RAIZ, "assets/mukhair.js"), cabecera + JSON.stringify(productos, null, 1) + ";\n");
console.log(`Listo: ${productos.length} productos en assets/mukhair.js`);
