// Carta de servicios de Cieza Barber Studio.
// Es la misma lista que la migración 0007 mete en Supabase (mismos `id`), así
// que la lista de precios del sitio y lo que ofrece el reservador coinciden.
// Editar aquí solo el texto de vitrina; los precios que cobra el bot viven en
// la tabla `services`.
var CIEZA_SERVICIOS = [
  {
    id: "corte-basico", grupo: "Principales", categoria: "Corte & barba",
    nombre: "Corte básico", precio: 40, duracion: "45 min", minutos: 45,
    desc: "Corte de cabello."
  },
  {
    id: "experiencia-cieza", grupo: "Principales", categoria: "Corte & barba",
    nombre: "Experiencia Cieza", precio: 60, duracion: "1 h", minutos: 60,
    desc: "Corte de cabello, desinflamante de ojeras, asesoramiento personalizado, lavado de cabello y acabado con productos premium."
  },
  {
    id: "corte-ritual-barba", grupo: "Principales", categoria: "Corte & barba",
    nombre: "Corte + ritual de barba", precio: 70, duracion: "1 h", minutos: 60,
    desc: "Corte de cabello y barba, con toalla caliente y masajes."
  },
  {
    id: "servicio-premium", grupo: "Principales", categoria: "Corte & barba",
    nombre: "Servicio premium", precio: null, duracion: "1 h 20 min", minutos: 80,
    desc: "Corte de cabello detallado + limpieza facial profunda con exfoliación, vaporizador, toallas calientes y mascarilla hidratante. Refresca tu piel y tu look en una sola sesión."
  },
  {
    id: "servicio-lujo", grupo: "Principales", categoria: "Corte & barba",
    nombre: "Servicio de lujo", precio: 130, duracion: "1 h 30 min", minutos: 90,
    desc: "Corte de cabello + barba + limpieza facial."
  },
  {
    id: "ritual-barba", grupo: "Complementarios", categoria: "Corte & barba",
    nombre: "Ritual de barba", precio: null, duracion: "40 min", minutos: 40,
    desc: "Corte de barba + vaporizador + toalla caliente y masajes."
  },
  {
    id: "mechas-iluminacion", grupo: "Opcionales", categoria: "Color & textura",
    nombre: "Mechas e iluminación", precio: 250, duracion: "3 a 4 h", minutos: 210,
    desc: "Luz y dimensión con técnicas personalizadas: babylights, balayage, face framing o mechas clásicas. Incluye decoloración selectiva, matización, tratamiento nutritivo y finalizado con styling."
  },
  {
    id: "platinado-global", grupo: "Opcionales", categoria: "Color & textura",
    nombre: "Platinado global", precio: 300, duracion: "3 a 4 h", minutos: 210,
    desc: "Gris/plata frío y uniforme para un cambio radical. Incluye decoloración total, matización, tratamiento hidratante y sellado de color. Requiere evaluación capilar previa."
  },
  {
    id: "ondulacion", grupo: "Opcionales", categoria: "Color & textura",
    nombre: "Ondulación", precio: 220, duracion: "2 a 3 h", minutos: 150,
    desc: "Ondulación y semi ondulación: ondas suaves, naturales o marcadas según tu preferencia, con volumen y movimiento."
  },
  {
    id: "camuflaje-canas", grupo: "Opcionales", categoria: "Color & textura",
    nombre: "Camuflaje de canas", precio: 80, duracion: "1 h", minutos: 60,
    desc: "Ideal para verse más joven sin perder la apariencia natural."
  },
  {
    id: "facial-basico", grupo: "Complementarios", categoria: "Facial",
    nombre: "Facial básico", precio: 60, duracion: "45 min", minutos: 45,
    desc: "Limpieza facial + vaporizador + toalla caliente + masajes y mascarilla hidratante."
  },
  {
    id: "limpieza-facial-premium", grupo: "Complementarios", categoria: "Facial",
    nombre: "Limpieza facial premium", precio: 80, duracion: "1 h", minutos: 60,
    desc: "Limpieza facial + extracción de puntos negros + doble exfoliación + masajes y mascarilla hidratante con vitamina C."
  }
];

// Las tres columnas de la lista de precios, en el orden en que se muestran.
var CIEZA_CARTA = [
  { titulo: "Corte & barba", nota: "Incluye bebida de cortesía", categoria: "Corte & barba" },
  { titulo: "Color & textura", nota: "Requiere evaluación previa", categoria: "Color & textura" },
  { titulo: "Facial", nota: "Piel limpia, look completo", categoria: "Facial" }
];
