/* eslint-disable @typescript-eslint/no-require-imports */
// Seed popular strains into the database (idempotent via upsert on name)
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

const strains = [
  ["Blue Dream","Hybrid","Blueberry x Haze","DJ Short","Sativa-dominant classic. Sweet berry aroma, balanced cerebral lift with gentle body relaxation. Easy to grow, high yields, ~9-10 week flower."],
  ["OG Kush","Hybrid","Chemdawg x Hindu Kush","Unknown","West Coast staple. Earthy pine and fuel, heavy euphoria. Moderate difficulty, ~8-9 week flower."],
  ["Girl Scout Cookies","Hybrid","OG Kush x Durban Poison","Cookie Fam","Dessert strain — sweet, earthy, minty. Strong euphoria. ~9-10 week flower."],
  ["Wedding Cake","Indica","Triangle Kush x Animal Mints","Seed Junky","Vanilla frosting aroma, relaxing and calming. Dense frosty buds, ~8-9 weeks."],
  ["Gelato","Hybrid","Sunset Sherbet x Thin Mint GSC","Sherbinski","Sweet creamy citrus, potent euphoria. Likes it warm, ~8-9 weeks."],
  ["Sour Diesel","Sativa","Chemdawg 91 x Super Skunk","Unknown","Pungent diesel aroma, fast-acting energetic high. Tall stretchy plant, ~10-11 weeks."],
  ["Purple Punch","Indica","Larry OG x Granddaddy Purple","Supernova Gardens","Grape candy and blueberry, sedating and sweet. Short, colorful, ~8-9 weeks."],
  ["Northern Lights","Indica","Afghani x Thai","Sensi Seeds","Legendary easy indica. Resinous, fast ~7-8 week flower, great for beginners."],
  ["White Widow","Hybrid","Brazilian Sativa x South Indian Indica","Green House Seeds","90s classic. Heavy resin, energetic buzz. Very beginner-friendly, ~8-9 weeks."],
  ["Jack Herer","Sativa","Haze x Northern Lights #5 x Shiva Skunk","Sensi Seeds","Spicy pine, clear-headed creative high. ~9-10 weeks."],
  ["Gorilla Glue #4","Hybrid","Chem's Sister x Sour Dubb x Chocolate Diesel","GG Strains","Extremely sticky, heavy relaxation. ~8-9 weeks, huge resin production."],
  ["Granddaddy Purple","Indica","Purple Urkle x Big Bud","Ken Estes","Deep purple buds, grape and berry, sleepy and relaxing. ~8-9 weeks."],
  ["Durban Poison","Sativa","South African landrace","Unknown","Pure sativa landrace. Sweet anise, energetic. Very mold resistant, outdoor friendly."],
  ["Pineapple Express","Hybrid","Trainwreck x Hawaiian","G13 Labs","Tropical pineapple, uplifting and social. Easy, ~8-9 weeks."],
  ["Zkittlez","Indica","Grape Ape x Grapefruit","3rd Gen Family","Candy-sweet tropical fruit, relaxing and happy. ~8-9 weeks."],
  ["Mimosa","Hybrid","Clementine x Purple Punch","Symbiotic Genetics","Orange citrus, brunch strain. Uplifting, ~9 weeks."],
  ["Runtz","Hybrid","Gelato x Zkittlez","Runtz/Cookies","Candy-sweet, colorful buds, euphoric. Moderate difficulty, ~8-9 weeks."],
  ["Chemdawg","Hybrid","Unknown (Nepalese/Thai?)","Unknown","Fuel-heavy parent of OG Kush and Sour D. Potent, ~9 weeks."],
  ["Trainwreck","Sativa","Mexican x Thai x Afghani","Unknown","Lemon pine menthol, fast-hitting. Tall, ~8-9 weeks."],
  ["Bruce Banner","Hybrid","OG Kush x Strawberry Diesel","Delta9 Labs","Very high THC, diesel and sweet berry. ~9-10 weeks."],
  ["GMO Cookies","Indica","GSC x Chemdawg","Mamiko Seeds","Garlic mushroom onion funk. Very potent, heavy resin, ~10 weeks."],
  ["Apple Fritter","Hybrid","Sour Apple x Animal Cookies","Lumpy's Flowers","Sweet pastry apple, balanced high. ~8-9 weeks."],
  ["Strawberry Cough","Sativa","Strawberry Fields x Haze","Kyle Kushman","Fresh strawberry, smooth uplifting. ~9 weeks."],
  ["Amnesia Haze","Sativa","South Asian x Jamaican x Afghani","Soma Seeds","Citrus haze, long flowering ~10-12 weeks, big yields."],
  ["Blue Cheese","Indica","Blueberry x UK Cheese","Big Buddha","Cheese and berry funk, relaxing. ~8 weeks."],
  ["AK-47","Hybrid","Colombian x Mexican x Thai x Afghani","Serious Seeds","Long-time favorite, mellow long-lasting. ~8-9 weeks."],
  ["White Rhino","Indica","White Widow x North American Indica","Green House","Heavy resin, sedating. ~9 weeks."],
  ["Critical Mass","Indica","Afghani x Skunk #1","Mr. Nice","Huge dense yields — watch for mold. ~7-8 weeks."],
  ["Bubba Kush","Indica","OG Kush phenotype","Unknown","Coffee and chocolate, heavy tranquilizing body high. ~8-9 weeks."],
  ["Skywalker OG","Indica","Skywalker x OG Kush","Unknown","Spicy herbal, relaxing. ~8-9 weeks."],
  ["Forbidden Fruit","Indica","Cherry Pie x Tangie","Chameleon Extracts","Tropical cherry citrus, beautiful purple buds. ~9 weeks."],
  ["Slurricane","Indica","Do-Si-Dos x Purple Punch","In House Genetics","Sweet grape berry, heavy frost, sedating. ~9 weeks."],
  ["Ice Cream Cake","Indica","Wedding Cake x Gelato #33","Seed Junky","Creamy vanilla dough, sleepy. ~8-9 weeks."],
  ["Mac 1","Hybrid","Alien Cookies x Colombian x Starfighter","Capulator","Creamy citrus, frosty, clone-only elite. ~9-10 weeks."],
  ["Gary Payton","Hybrid","The Y x Snowman","Cookies/Powerzzz","Balanced potent hybrid, spicy herbal. ~9 weeks."],
  ["Tropicana Cookies","Hybrid","GSC x Tangie","Oni Seed Co","Orange citrus, purple buds, uplifting. ~9-10 weeks."],
  ["Do-Si-Dos","Indica","OGKB x Face Off OG","Archive","Lime mint cookie funk, powerful body high. ~8-9 weeks."],
  ["Cereal Milk","Hybrid","The Y x Snowman","Cookies","Sweet creamy, balanced. ~9-10 weeks."],
  ["Jet Fuel","Sativa","Aspen OG x High Country Diesel","303 Seeds","Diesel rocket fuel, energetic. ~9-10 weeks."],
  ["God's Gift","Indica","Granddaddy Purple x OG Kush","Unknown","Grape citrus, dreamy sedating. ~8-9 weeks."],
  ["Maui Wowie","Sativa","Hawaiian landrace","Unknown","Tropical pineapple, old-school island sativa. Prefers warm climates."],
  ["Afghan Kush","Indica","Hindu Kush landrace","Unknown","Pure landrace indica, hashy earthy, compact and hardy. ~7-8 weeks."],
  ["Super Lemon Haze","Sativa","Lemon Skunk x Super Silver Haze","Green House","Zesty lemon candy, energetic award winner. ~10 weeks."],
  ["Super Silver Haze","Sativa","Skunk x Northern Lights x Haze","Green House","Long-lasting energetic haze classic. ~10-11 weeks."],
  ["Chocolope","Sativa","Chocolate Thai x Cannalope Haze","DNA Genetics","Chocolate coffee, energetic. ~9-10 weeks."],
  ["Green Crack","Sativa","Skunk #1","Cecil C.","Sharp mango energy, daytime favorite. ~7-8 weeks, easy."],
  ["Lemon Skunk","Hybrid","Two Skunk phenotypes","DNA Genetics","Strong lemon, happy and relaxing. ~8-9 weeks."],
  ["LA Confidential","Indica","OG LA Affie x Afghani","DNA Genetics","Smooth pine skunk, calming. ~7-8 weeks."],
  ["Cherry Pie","Hybrid","Granddaddy Purple x Durban Poison","Unknown","Sweet tart cherry, cerebral and body balanced. ~8-9 weeks."],
  ["Banana Kush","Hybrid","Ghost OG x Skunk Haze","Unknown","Ripe banana, mellow euphoria. ~8-9 weeks."],
  ["Sunset Sherbet","Indica","GSC x Pink Panties","Sherbinski","Fruity dessert, relaxing. ~8-9 weeks."],
  ["Fire OG","Indica","OG Kush x SFV OG","Unknown","One of the strongest OGs, lemon pine. ~9-10 weeks."],
  ["Death Star","Indica","Sensi Star x Sour Diesel","Team Death Star","Diesel skunk, sedating. ~8-9 weeks."],
  ["Candyland","Sativa","Granddaddy Purple x Bay Platinum Cookies","Unknown","Sweet earthy, social and uplifting. ~8-9 weeks."],
  ["Blackberry Kush","Indica","Afghani x Blackberry","Unknown","Berry hash, relaxing. ~7-8 weeks."],
  ["Tahoe OG","Indica","OG Kush phenotype","Unknown","Lemon earthy, heavy sedation. ~9 weeks."],
  ["Strawberry Banana","Indica","Banana Kush x Bubble Gum","DNA Genetics/Serious","Sweet tropical, resin-rich. ~9 weeks."],
  ["Clementine","Sativa","Tangie x Lemon Skunk","Crockett Family","Bright orange citrus, energetic. ~8-9 weeks."],
  ["King Louis XIII","Indica","OG Kush x LA Confidential","Unknown","Pine musk, deeply relaxing. ~8-9 weeks."],
  ["Platinum OG","Indica","Master Kush x OG Kush x unknown","Unknown","Heavy and sedating, frosty. ~8-9 weeks."],
];

(async () => {
  for (const [name, type, genetics, breeder, description] of strains) {
    await p.strain.upsert({
      where: { name },
      update: {},
      create: { name, type, genetics, breeder, description },
    });
  }
  const total = await p.strain.count();
  console.log(`Seeded/updated ${strains.length} strains — total in DB: ${total}`);
  await p.$disconnect();
})();
