// Application State & Storage Initialization
let products = [];
let cart = JSON.parse(localStorage.getItem("shopflow_cart")) || [];
let currentUser = JSON.parse(localStorage.getItem("shopflow_user")) || null;

// Route Guard: Restrict admin-only pages from standard users
if ((location.pathname.endsWith("stock.html") || location.pathname.endsWith("orders.html")) && currentUser?.role !== "admin") {
  location.href = "index.html";
}

// Dynamic Navigation UI Updates based on User Role & Session
function syncHeaderNavigation() {
  const nav = document.querySelector("header nav");
  if (!nav) return;
  
  const getLink = href => nav.querySelector(`a[href="${href}"]`);
  const isNotAdmin = currentUser?.role !== "admin";

  // Hide admin navigation links for non-admin users
  if (getLink("stock.html")) getLink("stock.html").style.display = isNotAdmin ? "none" : "";
  if (getLink("orders.html")) getLink("orders.html").style.display = isNotAdmin ? "none" : "";

  // Render Login/Logout link state
  const loginLink = getLink("login.html");
  if (loginLink) {
    loginLink.textContent = currentUser ? `Logout (${currentUser.username})` : "Login";
    loginLink.href = currentUser ? "#" : "login.html";
    
    // Handle Logout Click Event
    loginLink.onclick = currentUser ? (e) => {
      e.preventDefault();
      
      // Confirmation validation prompt before clearing session
      const confirmLogout = confirm(`Are you sure you want to log out, ${currentUser.username}?`);
      if (confirmLogout) {
        localStorage.removeItem("shopflow_user");
        location.href = "index.html";
      }
    } : null;
  }
}

// Utility Helpers
const saveCart = () => localStorage.setItem("shopflow_cart", JSON.stringify(cart));
const val = id => document.getElementById(id)?.value.trim();

// Generic Fetch Wrapper for API Requests
async function fetchApi(url, method = "GET", body = null) {
  const options = { method, headers: body ? { "Content-Type": "application/json" } : {} };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// Fetch Initial Product List & Render Dependents
async function loadProducts() {
  try {
    products = await fetchApi("/api/products");
    renderProducts();
    renderStock();
    renderCart();
  } catch (err) { showMessage(err.message, true); }
}

// Filter and Render Public Product Grid
function renderProducts() {
  const list = document.getElementById("productList");
  if (!list) return;

  const query = val("search").toLowerCase();
  const cat = val("categoryFilter");

  // Apply search query and category filters
  const filtered = products.filter(p => p.name.toLowerCase().includes(query) && (!cat || p.category.toLowerCase() === cat.toLowerCase()));
  if (!filtered.length) return list.innerHTML = "<p>No products found matching your criteria.</p>";

  // Generate HTML templates for filtered products
  list.innerHTML = filtered.map(p => {
    const isOut = p.stock === 0;
    const isLow = p.stock > 0 && p.stock < 5;
    const badge = isOut ? '<span class="badge badge-out">Out of Stock</span>' : (isLow ? '<span class="badge badge-low">Low Stock</span>' : '');

    return `
      <article class="card product-card ${isOut ? 'out-of-stock' : ''}">
        <img src="${escapeHtml(p.image_url || 'default.jpg')}" alt="${escapeHtml(p.name)}" width="150">
        ${badge}
        <h3>${escapeHtml(p.name)}</h3>
        <p>${escapeHtml(p.category)}</p>
        <p class="price">RM ${Number(p.price).toFixed(2)}</p>
        <p>${p.stock} in stock</p>
        <button onclick="addToCart(${p.id})" ${isOut ? "disabled" : ""}>${isOut ? "Out of Stock" : "Add to Cart"}</button>
      </article>`;
  }).join("");
}

// Event Listeners for Product Filters
document.getElementById("search")?.addEventListener("input", renderProducts);
document.getElementById("categoryFilter")?.addEventListener("change", renderProducts);

// Add Product to Cart with Stock Checks
function addToCart(id) {
  const p = products.find(x => x.id === id);
  if (!p || p.stock <= 0) return showMessage(p ? `Sorry, ${p.name} is out of stock.` : "Product not found.", true);

  const item = cart.find(i => i.id === id);
  if ((item?.quantity || 0) + 1 > p.stock) return showMessage(`Cannot add more ${p.name}. Stock limit reached.`, true);

  item ? item.quantity++ : cart.push({ id, quantity: 1 });
  saveCart();
  renderCart();
  showMessage(`${p.name} added to cart!`);
}

// Render Cart Items & Calculate Total Cost
function renderCart() {
  const box = document.getElementById("cartItems");
  const totalEl = document.getElementById("cartTotal");
  if (!box || !totalEl) return;

  if (!cart.length) {
    box.innerHTML = "<p>Your cart is empty.</p>";
    return totalEl.innerHTML = "<strong>Total: RM 0.00</strong>";
  }

  let total = 0;
  box.innerHTML = cart.map(i => {
    const p = products.find(x => x.id === i.id);
    if (!p) return "";
    total += Number(p.price) * i.quantity;
    return `<div class="card">
      <strong>${escapeHtml(p.name)}</strong> × ${i.quantity}
      <button type="button" onclick="changeQty(${p.id}, 1)">+</button>
      <button type="button" onclick="changeQty(${p.id}, -1)">−</button>
    </div>`;
  }).join("");

  totalEl.innerHTML = `<strong>Total: RM ${total.toFixed(2)}</strong>`;
  updateCartCount();
}

// Update Cart Count Badge in Header Navigation
function updateCartCount() {
  const el = document.getElementById("cartCount");
  if (!el) return;
  const totalQty = cart.reduce((sum, item) => sum + item.quantity, 0);
  el.textContent = totalQty;
  el.style.display = totalQty > 0 ? "inline-flex" : "none";
}

// Modify Item Quantity in Cart
function changeQty(id, amount) {
  const p = products.find(x => x.id === id);
  const item = cart.find(i => i.id === id);
  if (!item) return;

  if (amount > 0 && p && item.quantity + amount > p.stock) return showMessage(`Cannot exceed available stock of ${p.stock}.`, true);

  item.quantity += amount;
  if (item.quantity <= 0) cart = cart.filter(i => i.id !== id);

  saveCart();
  renderCart();
}

// User Authentication: Login Form Submission Handler
document.getElementById("loginForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  try {
    const data = await fetchApi("/api/login", "POST", { username: val("username"), password: val("password") });
    currentUser = data.user;
    localStorage.setItem("shopflow_user", JSON.stringify(currentUser));
    showMessage(`Login successful! Welcome ${currentUser.username}.`);
    setTimeout(() => location.href = currentUser.role === "admin" ? "stock.html" : "index.html", 1000);
  } catch (err) { showMessage(err.message, true); }
});

// Shopping Cart: Checkout Submission Handler
document.getElementById("checkoutForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!cart.length) return showMessage("Your cart is empty.", true);

  try {
    const data = await fetchApi("/api/orders", "POST", { customerName: val("customerName"), customerEmail: val("customerEmail"), items: cart });
    showMessage(`Order #${data.orderId} placed successfully! Total: RM ${Number(data.total).toFixed(2)}`);
    cart = [];
    saveCart();
    e.target.reset();
    renderCart();
    await loadProducts();
    if (currentUser?.role === "admin") loadOrders();
  } catch (err) { showMessage(err.message, true); }
});

// Product Form Utilities
const getFormData = () => ({
  name: val("productName"),
  category: val("category"),
  price: Number(val("price")),
  stock: Number(val("stock")),
  image_url: val("imageUrl")
});

const fillForm = (p = {}) => {
  document.getElementById("productId").value = p.id || "";
  document.getElementById("productName").value = p.name || "";
  document.getElementById("category").value = p.category || "";
  document.getElementById("price").value = p.price || "";
  document.getElementById("stock").value = p.stock || "";
  document.getElementById("imageUrl").value = p.image_url || "";
};

// Admin CRUD Operations: Create Product
document.getElementById("productForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  try {
    const data = await fetchApi("/api/products", "POST", getFormData());
    showMessage(data.message);
    fillForm();
    await loadProducts();
  } catch (err) { showMessage(err.message, true); }
});

// Admin CRUD Operations: Read/Find Product
document.getElementById("readBtn")?.addEventListener("click", async () => {
  const id = val("productId");
  const name = val("productName").toLowerCase();
  try {
    let p = id ? await fetchApi(`/api/products/${id}`) : products.find(x => x.name.toLowerCase().includes(name));
    if (!p) throw new Error("Product not found.");
    fillForm(p);
    showMessage(`Product #${p.id} loaded into form.`);
  } catch (err) { showMessage(err.message, true); }
});

// Admin CRUD Operations: Update Product
document.getElementById("updateBtn")?.addEventListener("click", async () => {
  const id = val("productId");
  if (!id) return showMessage("Select a Product ID to update.", true);
  try {
    const data = await fetchApi(`/api/products/${id}`, "PUT", getFormData());
    showMessage(data.message);
    fillForm();
    await loadProducts();
  } catch (err) { showMessage(err.message, true); }
});

// Form Actions: Delete Trigger & Cancel Reset Handler
document.getElementById("deleteBtn")?.addEventListener("click", () => deleteProduct(val("productId")));
document.getElementById("cancelEdit")?.addEventListener("click", () => { fillForm(); showMessage("Form cleared."); });

// Admin CRUD Operations: Delete Product
async function deleteProduct(id) {
  if (!id) return showMessage("Please specify a Product ID.", true);
  if (!confirm(`Delete product #${id}?`)) return;
  try {
    const data = await fetchApi(`/api/products/${id}`, "DELETE");
    showMessage(data.message);
    fillForm();
    await loadProducts();
  } catch (err) { showMessage(err.message, true); }
}

// Render Admin Inventory/Stock Table
function renderStock() {
  const table = document.getElementById("stockTable");
  if (!table || currentUser?.role !== "admin") return;
  if (!products.length) return table.innerHTML = "<p>No products available.</p>";

  table.innerHTML = `
    <table>
      <thead><tr><th>ID</th><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Image</th><th>Actions</th></tr></thead>
      <tbody>
      ${products.map(p => `
        <tr>
          <td>#${p.id}</td><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.category)}</td>
          <td>RM ${Number(p.price).toFixed(2)}</td>
          <td>${p.stock} ${p.stock === 0 ? '<span class="badge badge-out">Out</span>' : (p.stock < 5 ? '<span class="badge badge-low">Low</span>' : '')}</td>
          <td>${escapeHtml(p.image_url || 'default.jpg')}</td>
          <td>
            <button type="button" onclick="editProduct(${p.id})">Edit</button>
            <button type="button" onclick="deleteProduct(${p.id})">Delete</button>
          </td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

// Helper to Load Selected Product into Form for Editing
function editProduct(id) {
  const p = products.find(x => x.id === id);
  if (p) { fillForm(p); showMessage(`Loaded product #${p.id}.`); }
}

// Render Admin Orders Management Table
async function loadOrders() {
  const table = document.getElementById("ordersTable");
  if (!table || currentUser?.role !== "admin") return;
  try {
    const orders = await fetchApi("/api/orders");
    if (!orders.length) return table.innerHTML = "<p>No orders recorded yet.</p>";

    table.innerHTML = `
      <table>
        <thead><tr><th>Order ID</th><th>Customer</th><th>Total</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
        <tbody>${orders.map(o => `<tr>
          <td>#${o.id}</td><td>${escapeHtml(o.customer_name)}</td>
          <td>RM ${Number(o.total).toFixed(2)}</td><td>${escapeHtml(o.status)}</td>
          <td>${new Date(o.created_at).toLocaleString()}</td>
          <td><button type="button" onclick="deleteOrder(${o.id})">Delete</button></td>
        </tr>`).join("")}</tbody>
      </table>`;
  } catch (err) { showMessage(err.message, true); }
}

// Admin Operations: Delete Order
async function deleteOrder(id) {
  if (!confirm(`Delete order #${id}?`)) return;
  try {
    const data = await fetchApi(`/api/orders/${id}`, "DELETE");
    showMessage(data.message);
    loadOrders();
  } catch (err) { showMessage(err.message, true); }
}

// UI Feedback Toast/Notification Display
function showMessage(text, error = false) {
  const el = document.getElementById("message");
  if (!el) return;
  el.textContent = text;
  el.className = error ? "alert" : "success-message";
}

// Security Helper: Sanitize Strings to Prevent XSS Attacks
function escapeHtml(val) {
  return String(val).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
}

// Application Initialization Entry Point
document.addEventListener("DOMContentLoaded", () => {
  syncHeaderNavigation();
  updateCartCount();
  loadProducts();
  if (currentUser?.role === "admin") loadOrders();
});