CREATE TABLE IF NOT EXISTS "AffiliatePartner" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "slug" TEXT NOT NULL,
  "logoUrl" TEXT, "websiteUrl" TEXT NOT NULL, "affiliateUrl" TEXT NOT NULL,
  "promoCode" TEXT, "description" TEXT NOT NULL, "promoText" TEXT,
  "promoStart" TIMESTAMP(3), "promoEnd" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true, "featured" BOOLEAN NOT NULL DEFAULT false,
  "adminNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AffiliatePartner_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AffiliatePartner_slug_key" UNIQUE ("slug")
);
CREATE INDEX IF NOT EXISTS "AffiliatePartner_active_idx" ON "AffiliatePartner"("active");
CREATE INDEX IF NOT EXISTS "AffiliatePartner_featured_idx" ON "AffiliatePartner"("featured");

CREATE TABLE IF NOT EXISTS "AffiliateProduct" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "slug" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL, "productUrl" TEXT, "affiliateUrl" TEXT,
  "imageUrl" TEXT, "description" TEXT NOT NULL, "category" TEXT NOT NULL,
  "pros" TEXT, "cons" TEXT, "recommendedFor" TEXT, "price" TEXT, "promoCode" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true, "featured" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AffiliateProduct_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AffiliateProduct_slug_key" UNIQUE ("slug"),
  CONSTRAINT "AffiliateProduct_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "AffiliatePartner"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "AffiliateProduct_partnerId_idx" ON "AffiliateProduct"("partnerId");
CREATE INDEX IF NOT EXISTS "AffiliateProduct_category_idx" ON "AffiliateProduct"("category");
CREATE INDEX IF NOT EXISTS "AffiliateProduct_active_idx" ON "AffiliateProduct"("active");

CREATE TABLE IF NOT EXISTS "AffiliateClick" (
  "id" TEXT NOT NULL, "partnerId" TEXT NOT NULL, "productId" TEXT,
  "page" TEXT, "userId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AffiliateClick_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AffiliateClick_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "AffiliatePartner"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AffiliateClick_productId_fkey" FOREIGN KEY ("productId") REFERENCES "AffiliateProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AffiliateClick_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "AffiliateClick_partnerId_idx" ON "AffiliateClick"("partnerId");
CREATE INDEX IF NOT EXISTS "AffiliateClick_productId_idx" ON "AffiliateClick"("productId");
CREATE INDEX IF NOT EXISTS "AffiliateClick_createdAt_idx" ON "AffiliateClick"("createdAt");

CREATE TABLE IF NOT EXISTS "Setting" (
  "key" TEXT NOT NULL, "value" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);
