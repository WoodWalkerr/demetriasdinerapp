// Starting data and fixed lists. Products, prices, stock and add-ons live in the
// DATABASE and are edited in /staff → Products. The lists below are only used to
// fill an empty database the first time the site runs.

export const CURRENCY = 'PHP';

export const CATEGORIES = {
  hotcoffee:  'Hot Coffee',
  icedcoffee: 'Iced Coffee',
  orange:     'Orange District',
  pistachio:  'Pistachio Infusion',
  matcha:     'G-Matcha',
  favorite:   "Diner's Favorite",
  boba:       'Boba Tea',
  fruitlatte: 'Fruit Latte',
  soda:       'Fruit Soda',
  silog:      'Silog Meals',
  snacks:     'Snacks',
  food:       'Meals',
  pastries:   'Pastries',
  others:     'Others',
};
/** drink → sweetness, ice, drink add-ons · food → food add-ons · plain → no options. Packaging goes with drinks and food. */
const FOOD_CATS = ['silog', 'snacks', 'food', 'pastries'];
const defaultKind = (cat) => (FOOD_CATS.includes(cat) ? 'food' : cat === 'others' ? 'plain' : 'drink');
// Categories are editable in /staff → Products → Categories (name, type, order on the website). The saved list
// lives in settings.categories; CATEGORIES above is only the starting list. getSettings() calls useCategories(),
// so kindOf() knows the type of categories you added.
export const CATEGORY_KINDS = { drink: 'Drink (sweetness & ice)', food: 'Food', plain: 'Other (no options)' };
export const DEFAULT_CATEGORY_LIST = Object.entries(CATEGORIES).map(([key, label]) => ({ key, label, kind: defaultKind(key) }));
let KINDS = {};
export function useCategories(list) { KINDS = Object.fromEntries(list.map((c) => [c.key, c.kind])); return list; }
export const catObject = (list) => Object.fromEntries(list.map((c) => [c.key, c.label]));
export const kindOf = (cat) => KINDS[cat] || defaultKind(cat);
export const ADDON_GROUPS = { drink: 'Drink add-ons', food: 'Food add-ons', packaging: 'Packaging' };
export const addonGroupsFor = (cat) => ({ food: ['food', 'packaging'], drink: ['drink', 'packaging'], plain: [] })[kindOf(cat)];

export const slug = (name) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// P(category, name, selling price ₱ or null, cost ₱ or null, extra)
//   price null → not for sale yet (hidden from customers; set it in /staff → Products)
//   cost  null → cost not known yet (profit can't be calculated for it until you set it)
const P = (cat, name, peso, cost, extra = {}) => ({
  id: slug(name), cat, name, price: peso == null ? null : Math.round(peso * 100), cost: cost == null ? null : Math.round(cost * 100), hot: false, ...extra,
});
const HOT = { hot: true };

/** The menu (Demetria's price list + costing sheet). Edit later in /staff → Products. */
export const DEFAULT_PRODUCTS = [
  // Hot Coffee (cost: ₱22 per serving for all hot coffee)
  P('hotcoffee', 'Hot Americano', 109, 22, HOT), P('hotcoffee', 'Hot Cappuccino', 119, 22, HOT), P('hotcoffee', 'Hot Caramel Macchiato', 109, 22, HOT),
  P('hotcoffee', 'Hot Choco', 109, 22, HOT), P('hotcoffee', 'Hot Spanish Cinnamon', 119, 22, HOT), P('hotcoffee', 'Hot Spanish Latte', 109, 22, HOT),
  // Iced Coffee (costs per variant: set in Products; Iced Spanish Latte from the costing sheet)
  P('icedcoffee', 'Iced Americano', 109, null), P('icedcoffee', 'Iced Cappuccino', 119, null), P('icedcoffee', 'Iced Caramel Macchiato', 119, null),
  P('icedcoffee', 'Iced Latte', 119, null), P('icedcoffee', 'Iced Nutty Mocha', 119, null), P('icedcoffee', 'Iced Spanish Cinnamon', 119, null),
  P('icedcoffee', 'Iced Spanish Mocha Latte', 139, null), P('icedcoffee', 'Iced Spanish Latte', 119, 23.64), P('icedcoffee', 'Choco Hazelnut Latte', null, 25),
  // Orange District
  P('orange', 'Orange Americano', 119, 22), P('orange', 'Orange Americano - Cinnamon', 139, null), P('orange', 'Orange Cocoa', 129, 21),
  P('orange', 'Orange Matcha - Non Dairy', 139, 22),
  // Pistachio Infusion Series
  P('pistachio', 'Dark Pistachio Mocha', 159, 43), P('pistachio', 'Pistachio Biscoff Bliss', 169, 58), P('pistachio', 'Pistachio Mango Sunrise', 159, 49),
  P('pistachio', 'Pistachio Matcha Cloud', 159, 47), P('pistachio', 'Thai Tea Pistachio Swirl', 159, 52), P('pistachio', 'Violet Pistachio Silk', 159, 48),
  // G-Matcha (Matcha Series)
  P('matcha', 'Kiwi Matcha', 149, 39.98), P('matcha', 'Mango Matcha', 149, 39.98), P('matcha', 'Taro Matcha', 149, 35.98),
  P('matcha', 'Strawberry Matcha', 149, 39.98), P('matcha', 'Hazel Matcha', 149, 39.80), P('matcha', 'Caramel Matcha', null, 35.66),
  P('matcha', 'Dirty Matcha', null, 48.60), P('matcha', 'Matcha Latte', null, 34.98),
  // Diner's Favorite (Biscoff drinks + cocoa)
  P('favorite', "Bisco' Latte", 149, 45), P('favorite', 'Biscoff Matcha', 149, 39.83), P('favorite', 'Thai Biscoff', 149, 43.74),
  P('favorite', 'Thai Cocoa', 149, 36), P('favorite', 'Taro Cocoa', 149, 40), P('favorite', 'Taro Biscoff', null, 36), P('favorite', 'Biscoff Tiramisu', null, 48),
  // Boba Tea (milk-based)
  P('boba', 'Taro', 119, 20.22), P('boba', 'Thai', 119, 25.33), P('boba', 'Mango Cheesecake', 119, 29.87), P('boba', 'Choco', 119, 25.22),
  P('boba', 'Dark Choco', 119, 30.66), P('boba', 'Choco Hazelnut', 119, 27.72), P('boba', 'Red Velvet', 119, 39.33), P('boba', 'Wintermelon', 119, 18.31),
  P('boba', 'Okinawa', 119, 36.26), P('boba', 'Cookies & Cream', 119, 34.10),
  // Fruit Latte · Fruit Soda (all fruit soda: ₱20 cost)
  P('fruitlatte', 'Strawberry Latte', 119, 22), P('fruitlatte', 'Blueberry Latte', 119, null), P('fruitlatte', 'Mango Latte', 119, 19),
  P('soda', 'Strawberry Soda', 99, 20), P('soda', 'Green Apple Soda', 99, 20), P('soda', 'Blueberry Soda', 99, 20), P('soda', 'Kiwi Soda', 99, 20),
  P('soda', 'Mango Soda', 99, 20), P('soda', 'Orange Soda', 99, 20),
  // Silog Meals
  P('silog', 'Bacon Silog', 129, 33.50), P('silog', 'Chicksilog', 119, null), P('silog', 'Chosilog', 129, 24), P('silog', 'Cornsilog', 99, 38),
  P('silog', 'Hamsilog', 129, 24), P('silog', 'Hotsilog', 119, 24), P('silog', 'Tocilog-Chicken', 129, 28), P('silog', 'Tocilog-Pork', 129, null),
  // Snacks
  P('snacks', 'Barkada Bundle', 349, null), P('snacks', 'Carroza', 119, 19.25), P('snacks', 'Cheese Burger Deluxe', 99, 26), P('snacks', 'Chicken Fingers', 139, 69),
  P('snacks', 'Chicken Pops', 129, 60.67), P('snacks', 'Chicken Sandwich', 119, 25), P('snacks', 'Fries', 119, 22.50), P('snacks', 'Ham & Cheese', 99, 22),
  P('snacks', 'Ham & Egg', 99, 22), P('snacks', 'Ham & Egg w/ Cheese', 69, null), P('snacks', 'Red Velvet Cookie', 99, 59), P('snacks', 'Tuna Sandwich', 79, 28.24),
  // Meals (prices not on the price list yet → hidden until set)
  P('food', 'Pork Sisig', null, null), P('food', 'Chicken Sisig', null, 28), P('food', 'Sisig Platter', null, 58), P('food', 'Pork Sisig with Drinks', null, 59),
  P('food', 'Chicken Wings', null, 43), P('food', 'Chicken Alamax', null, 61), P('food', 'Chicken Ala Max with Fries and Rice', null, 78),
  P('food', 'Chicken Burger Deluxe', null, 26), P('food', 'Jalapeno Chicken Club', null, 34.80), P('food', 'Carbonara', null, 44.92),
  P('food', 'Spaghetti', null, 19.25), P('food', 'Chicken Snake', null, null),
  // Pastries
  P('pastries', 'Biscoff Cheesecake', 139, 60.77), P('pastries', 'Blueberry Cheesecake', 126, 49.86), P('pastries', 'Brownie', 49, null),
  P('pastries', 'Choco Banana Slice', 59, 12), P('pastries', 'Chocolate Cookie', 89, null), P('pastries', 'Cinnamon Roll', 69, null),
  P('pastries', 'Classic Banana Loaf', 149, null), P('pastries', 'Cookie', 99, null), P('pastries', "D'smores Cookie", 99, null),
  P('pastries', 'Double Chocolate Banana Muffin', 49, null), P('pastries', 'Double Chocolate Cookie', 99, null), P('pastries', 'Hazel Sandwich', 119, 18),
  P('pastries', 'OG Cookie', 99, null), P('pastries', 'Sponge Cake Slices', 39, 12),
  // Others
  P('others', 'Coke Swakto', 29, null), P('others', 'Le Minerale', 29, null), P('others', 'Mineral Water', 29, null), P('others', 'Sauce', 20, null),
  P('others', 'Sprite', 29, null), P('others', 'Take Out Box', 8, null),
].map((p, i) => ({ ...p, sort: i * 10 }));

/** Items from the old menu that the new price list replaces. They are hidden (not erased: past sales keep them). */
export const RETIRED_PRODUCTS = ['spanish-latte', 'upgraded-spanish-latte', 'cinnamon-spanish-latte', 'latte', 'caramel-macchiato', 'cappuccino',
  'nutty-mocha', 'long-black', 'orange-matcha', 'tocilog', 'carroza-sandwich'];

/** Which version of the menu above has been applied to the database (bumped when the price list changes). */
export const CATALOG_VERSION = '2';

const A = (grp, name, peso, cost = null) => ({ id: slug(name), grp, name, price: peso * 100, cost: cost == null ? null : Math.round(cost * 100) });
export const DEFAULT_ADDONS = [
  A('drink', 'Cream Cheese Topping', 25), A('drink', 'Sea Salt', 25), A('drink', 'Whipped Cream', 15), A('drink', 'Extra Matcha Shot', 20),
  A('drink', 'Boba Pearls', 15), A('drink', 'Oatside', 25), A('drink', 'Popping Boba', 25), A('drink', 'Brown Sugar', 10),
  A('drink', 'Chocolate Shot', 15), A('drink', 'Espresso Shot', 35),
  A('food', 'Cheese', 20), A('food', 'Bacon', 20), A('food', 'Egg', 20), A('food', 'Jalapeño', 15), A('food', 'Rice', 25, 4),
  A('packaging', 'Takeout Bag', 10),
].map((a, i) => ({ ...a, sort: i * 10 }));

// Free drink options.
export const SWEETNESS = [0, 25, 50, 75, 100];
export const ICE = ['No ice', 'Less ice', 'Regular ice', 'Extra ice'];

export const PICKUP_MINUTES = { 10: 'ASAP (~10 min)', 20: 'In 20 min', 30: 'In 30 min', 45: 'In 45 min', 60: 'In 1 hour' };

// How online customers pay.
//   qrph               → customer scans YOUR GCash/Maya QR, enters the reference no., staff confirm it
//   gcash/paymaya      → through PayMongo (automatic confirmation; needs a PayMongo account)
//   (No card payments: Demetria's doesn't take cards.)
//   counter            → pay at pickup (or cash on delivery)
export const PAYMENT_METHODS = {
  qrph:    { label: 'GCash / Maya QR', online: false, manual: true },
  gcash:   { label: 'GCash', online: true },
  paymaya: { label: 'Maya',  online: true },
  counter: { label: 'Pay at counter', online: false },
};

// Money the cashier takes in person (POS, collecting a pay-at-counter order). Can be split.
export const TENDER_METHODS = { cash: 'Cash', gcash: 'GCash', paymaya: 'Maya' };

// Discounts the POS can apply to the whole ticket. Senior citizen / PWD: 20% by law. Ask your
// accountant how to record the VAT exemption on official receipts; this only computes the discount.
export const DISCOUNTS = {
  senior: { label: 'Senior citizen (20%)', pct: 20, needsId: true },
  pwd:    { label: 'PWD (20%)', pct: 20, needsId: true },
  staff:  { label: 'Staff (10%)', pct: 10 },
};

// Staff permissions. Admins always have all of them.
export const PERMS = {
  pos:         'Use the POS and the order board',
  cash:        'Cash in / cash out',
  void:        'Cancel, void and refund orders',
  inventory:   'Edit stock and mark items sold out',
  edit_prices: 'Edit products, prices and add-ons',
  sales:       'See the sales dashboard, all shifts and exports',
  finance:     'Costs, expenses, liquidation and profit',
  settings:    'Change settings (payments, delivery, QR)',
  users:       'Manage staff accounts',
  audit:       'See the activity log (who changed what)',
  discounts:   'Give custom discounts at the POS (any % or ₱ amount)',
};
export const ROLES = {
  admin:   { label: 'Admin', perms: Object.keys(PERMS) },
  manager: { label: 'Manager', perms: ['pos', 'cash', 'void', 'inventory', 'edit_prices', 'sales', 'finance', 'settings', 'audit', 'discounts'] },
  cashier: { label: 'Cashier', perms: ['pos', 'cash'] },
};

export const CASH_CATEGORIES = {
  in:  ['Change fund', 'Owner deposit', 'Other income'],
  out: ['Supplies', 'Ingredients', 'Packaging', 'Delivery / rider', 'Utilities', 'Salary advance', 'Other expense'],
};

export const DELIVERY_DEFAULTS = {
  enabled: false, lat: null, lng: null, maxKm: 6,
  tiers: [{ upToKm: 2, fee: 2000 }, { upToKm: 4, fee: 3000 }, { upToKm: 6, fee: 4000 }],
  minOrder: 0, eta: '30–45 min',
};

// Monthly costing & liquidation. "purchase" = buying stock (shown as money spent, not deducted
// again from profit because cost of goods already counts what was sold); "operating" = expenses.
export const EXPENSE_CATEGORIES = {
  ingredients: { label: 'Raw materials & ingredients', group: 'purchase' },
  packaging:   { label: 'Packaging', group: 'purchase' },
  inventory:   { label: 'Inventory purchases & restocking', group: 'purchase' },
  cogs_adj:    { label: 'Cost of goods adjustment (spoilage, waste)', group: 'cogs' },
  employee:    { label: 'Employee (salaries, benefits, meals)', group: 'operating' },
  utilities:   { label: 'Utilities (electricity, water, internet, gas)', group: 'operating' },
  rent:        { label: 'Rent', group: 'operating' },
  operations:  { label: 'Other operating (repairs, delivery, fees)', group: 'operating' },
  misc:        { label: 'Miscellaneous', group: 'operating' },
};
/** Shift "cash out" entries count in the liquidation under these categories. */
export const CASH_OUT_TO_EXPENSE = {
  'Supplies': 'operations', 'Ingredients': 'ingredients', 'Packaging': 'packaging', 'Delivery / rider': 'operations',
  'Utilities': 'utilities', 'Salary advance': 'employee', 'Other expense': 'misc',
};