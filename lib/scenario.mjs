/**
 * @module scenario
 * Seed data factory for the RescueRoute demo scenario.
 * Coordinates are kilometres on a local fictional grid — not real addresses.
 * This module is used by {@link module:database} to populate a fresh database
 * and by tests to obtain a known-good baseline planning scenario.
 */

// Fictional coordinates are kilometres on a local grid, not real addresses.
/**
 * Creates a fresh, deterministic demo scenario with three offers, two requests,
 * and two volunteers, all set in the fictional Harbor City network.
 * @returns {object} A complete planning scenario object compatible with {@link module:validation}.
 */
export function createScenario() {
  return {
    city: "Harbor City",
    now: 16 * 60,
    revision: 1,
    offers: [
      {
        id: "o1",
        name: "The Green Table",
        food: "Vegetable rice bowls",
        meals: 32,
        point: [3, 2],
        ready: 960,
        deadline: 1000,
        allergens: [],
        handling: "ambient",
        verified: true,
      },
      {
        id: "o2",
        name: "Daily Bread Bakery",
        food: "Sandwiches & pastries",
        meals: 28,
        point: [7, 3],
        ready: 960,
        deadline: 1030,
        allergens: ["gluten", "dairy"],
        handling: "ambient",
        verified: true,
      },
      {
        id: "o3",
        name: "Roots Kitchen",
        food: "Chilled lentil meal boxes",
        meals: 20,
        point: [4, 7],
        ready: 970,
        deadline: 1050,
        allergens: [],
        handling: "chilled",
        verified: true,
      },
    ],
    requests: [
      {
        id: "r1",
        name: "Northside Community Shelter",
        meals: 45,
        point: [9, 2],
        deadline: 1060,
        excludes: [],
        priority: 2,
      },
      {
        id: "r2",
        name: "Riverside Family Centre",
        meals: 35,
        point: [2, 8],
        deadline: 1050,
        excludes: ["gluten", "dairy"],
        priority: 3,
      },
    ],
    volunteers: [
      {
        id: "v1",
        name: "Maya Chen",
        initials: "MC",
        vehicle: "Car",
        capacity: 35,
        point: [1, 2],
        available: 960,
        until: 1080,
        chilled: false,
        active: true,
      },
      {
        id: "v2",
        name: "Alex Morgan",
        initials: "AM",
        vehicle: "Insulated cargo van",
        capacity: 45,
        point: [5, 6],
        available: 960,
        until: 1080,
        chilled: true,
        active: true,
      },
    ],
  };
}
