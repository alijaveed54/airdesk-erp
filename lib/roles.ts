export type UserRole = "Admin" | "Manager" | "Staff";

export const rolePermissions = {
  Admin: {
    dashboard: true,
    products: true,
    orders: true,
    inventory: true,
    images: true,
    reports: true,
    users: true,
    settings: true,
  },
  Manager: {
    dashboard: true,
    products: true,
    orders: true,
    inventory: true,
    images: true,
    reports: true,
    users: false,
    settings: false,
  },
  Staff: {
    dashboard: true,
    products: true,
    orders: true,
    inventory: false,
    images: true,
    reports: false,
    users: false,
    settings: false,
  },
};
