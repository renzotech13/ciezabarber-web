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

// Precio real de venta al público (pedido del negocio, agosto 2026): el
// precio del proveedor no es lo que se cobra en tienda. Va por id de
// WooCommerce (estable aunque cambie el precio o el nombre del lado del
// proveedor), así una corrida futura del script no pisa esta corrección.
const PRECIO_REAL = {
  // Barros/cremas/gomina de peinado individuales: S/75 -> S/110
  "8952": 110, "8884": 110, "8879": 110, "8874": 110, "8869": 110, "8864": 110, "8859": 110,
  "8891": 110, // Fat MUK Voluminizador: S/100 -> S/110
  "11221": 110, // mr. muk Shampoo de estilizado y textura
  // Duo Gift Pack (línea individual en combo chico): S/148 -> S/180
  "8992": 180, "8984": 180, "8982": 180, "8980": 180, "8976": 180, "8978": 180, "8974": 180, "8986": 180,
  // Dúos en combo: S/176 -> S/220
  "8960": 220, "9012": 220, "8958": 220, "8968": 220, "8962": 220, "8956": 220, "8970": 220, "9016": 220, "8994": 220,
  "11500": 180, // Travel Pack Trio Tratamiento Ultrasuave Deep MUK
  "8990": 230, // Dúo Shampoo y Tratamiento Milagroso 20 en 1 Head MUK
  "8998": 282, // Dúo Reparador Aceite de Argan
};

for (const p of productos) {
  if (PRECIO_REAL[p.id] != null) {
    p.precio = PRECIO_REAL[p.id];
    p.precio_lista = PRECIO_REAL[p.id];
    p.oferta = false;
  } else if (p.oferta) {
    // El resto de descuentos del proveedor no se muestran: precio real
    // (precio de lista) en vez del precio rebajado, salvo lo de arriba.
    p.precio = p.precio_lista;
    p.oferta = false;
  }
  p.tags = p.tags.filter((t) => t !== "ofertas");
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
  { id: "packs", label: "Dúos & tríos" }
];

var MUK_PRODUCTOS = `;

await writeFile(join(RAIZ, "assets/mukhair.js"), cabecera + JSON.stringify(productos, null, 1) + ";\n");
console.log(`Listo: ${productos.length} productos en assets/mukhair.js`);
