// Fase 3: catálogo (categorías, servicios, productos) leído desde Supabase en vez
// de arreglos hardcodeados en cada página. Compartido por reserva.html, salon.html
// e index.html.
const SUPABASE_CONFIG = {
  url: "https://bowlmookhezvwwxofqoe.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvd2xtb29raGV6dnd3eG9mcW9lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5NzQzMzAsImV4cCI6MjEwMjU1MDMzMH0.EZw0fuT8o0qCrFYbiegoN46VXBrkXRcUmDL37gBHqGs"
};
const catalogClient = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

const CATALOG_GROUP_ORDER = ["Principales", "Complementarios", "Opcionales"];

async function fetchServiceGroups() {
  const { data, error } = await catalogClient
    .from("services")
    .select("id,name,duration,price,description,booking_group,sort_order")
    .eq("active", true)
    .order("sort_order");
  if (error) throw error;
  return CATALOG_GROUP_ORDER
    .map(title => ({
      title,
      services: data
        .filter(r => r.booking_group === title)
        .map(({ id, name, duration, price, description }) => ({ id, name, duration, price, description }))
    }))
    .filter(g => g.services.length > 0);
}

async function fetchSalonCategories() {
  const [{ data: cats, error: catErr }, { data: svcs, error: svcErr }] = await Promise.all([
    catalogClient.from("service_categories").select("*").eq("active", true).order("sort_order"),
    catalogClient.from("services").select("id,category_id").eq("active", true).order("sort_order")
  ]);
  if (catErr) throw catErr;
  if (svcErr) throw svcErr;
  return cats.map(c => ({
    id: c.id,
    icon: c.icon,
    title: c.title,
    desc: c.description,
    images: c.images,
    services: svcs.filter(s => s.category_id === c.id).map(s => s.id)
  }));
}

async function fetchProducts() {
  const { data, error } = await catalogClient
    .from("products")
    .select("*")
    .eq("active", true)
    .order("sort_order");
  if (error) throw error;
  return data;
}

async function fetchSiteContent() {
  const { data, error } = await catalogClient
    .from("site_content")
    .select("*")
    .eq("id", 1)
    .single();
  if (error) throw error;
  return data;
}

async function fetchTestimonials() {
  const { data, error } = await catalogClient
    .from("testimonials")
    .select("*")
    .eq("active", true)
    .order("sort_order");
  if (error) throw error;
  return data;
}

async function fetchCourses() {
  const { data, error } = await catalogClient
    .from("courses")
    .select("*")
    .eq("active", true)
    .order("sort_order");
  if (error) throw error;
  return data;
}
