-- Avatars the deployment owner shares with every member in Avatar Studio.
CREATE TABLE "avatar_gallery_items" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "valueSha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avatar_gallery_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "avatar_gallery_items_valueSha256_key" ON "avatar_gallery_items"("valueSha256");
