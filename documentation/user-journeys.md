# User Journeys

## Artist Journey (Leo)

### Step 1: Landing & Wallet Connection
User arrives at the Heritage Splitter landing page. Clicks "Enter Heritage" and connects their MetaMask wallet. The app requests a signature (`personal_sign`) to prove wallet ownership. A JWT token is issued.

### Step 2: Onboarding (3 steps)
First-time users go through onboarding:
1. **Role selection** — Choose "Artist" or "Producer". This determines access and navigation.
2. **KYC verification** — Provide legal name, date of birth, ID document number, and artist registration number (required for artists). Simulated verification.
3. **Profile creation** — Set display name, bio, and upload a profile picture.

### Step 3: Create a Project
The artist creates a project (e.g., "Ephemeral Lights") with a name, description, and optional logo. Projects are the organizational unit that group collections and collaborators.

### Step 4: Invite Collaborators
The artist invites other artists to the project by searching for them by name. Each invited collaborator receives a real-time notification and can accept or decline. The project creator defines allocation categories.

### Step 5: Define Allocations
The artist creates allocation categories (e.g., "Lead Artist: 60%", "Collaborator: 30%", "Producer: 10%") using basis points (10,000 = 100%). Each participant is assigned to a slot. All shares must sum to exactly 100%.

### Step 6: Create a Collection
Within the project, the artist creates an NFT collection. They upload artwork (images to MinIO storage), set titles, descriptions, prices in AVAX, and attributes for each NFT. NFTs are saved as drafts in the database.

### Step 7: Approval Workflow
The collection is submitted for approval. Every participant reviews the allocations and NFT details. All must approve before deployment. If anyone requests changes, the collection returns to draft status. Solo projects (no collaborators) auto-approve.

### Step 8: Deploy On-chain
Once all participants have approved, the artist clicks "Deploy". The backend executes a multi-step deployment:
1. Calls `CollectionFactory.createCollection()` → deploys CollectionNFT + ArtistsSplitter
2. Sets the backend wallet as authorized minter
3. Mints all draft NFTs to the backend wallet
4. Approves NFTMarket to transfer NFTs
5. Lists all NFTs on NFTMarket with their prices

Contract addresses are stored in the database and displayed in the Integration tab.

### Step 9: Share with Showrooms
The artist joins a producer's showroom (via invitation) and proposes their deployed collection. The producer can then accept and list the NFTs with a margin markup.

### Step 10: Receive Revenue
When NFTs are sold (directly via NFTMarket or via a Showroom), revenue is automatically split:
- ArtistsSplitter distributes each beneficiary's share
- PaymentRegistry delivers payments (push-first, pull-fallback)
- The artist can view transaction history and track payments on Snowtrace

---

## Producer Journey (Gil)

### Step 1–2: Onboarding
Same wallet connection and 3-step onboarding flow. The producer selects "Producer" role (no artist registration number required). They are redirected to the Showroom section after onboarding.

### Step 3: Create a Showroom
The producer creates a showroom (e.g., "Downtown Gallery") with a name and description. This is their digital storefront for curating and selling artist collections.

### Step 4: Invite Artists
The producer searches for artists by name and sends invitations to join the showroom. Artists receive real-time notifications and can accept or decline.

### Step 5: Curate Collections
Accepted artists can propose their deployed collections to the showroom. The producer reviews the proposals. Each collection's NFTs appear as potential listings. The producer sets a margin (e.g., 0.5 AVAX) on top of each NFT's base price. Margins can be set individually or in batch per collection.

### Step 6: Deploy Showroom
The producer deploys the showroom as a smart contract on Avalanche. The Showroom contract references the underlying NFTMarket listings and encodes the margin for each item. The backend wallet is set as deployer for management operations.

### Step 7: Publish Sale Page
The producer clicks "Create a public sale page". A unique public slug is generated. The resulting URL (e.g., `/showroom/sale/downtown-gallery`) is shareable. Anyone can browse and purchase NFTs without an account — they only need MetaMask.

### Step 8: Sales & Revenue
When a buyer purchases an NFT from the showroom:
- **Base price** → NFTMarket → ArtistsSplitter → artists (proportional split)
- **Margin** → PaymentRegistry → producer

The producer tracks all listings, margins, and collection status from the showroom dashboard. They can adjust margins, add new collections, or unpublish the sale page at any time.

---

## Buyer Journey (Public Sale)

### Step 1: Access Sale Page
The buyer receives a link to a showroom sale page. No account needed. The page displays all available NFTs with images, titles, artists, and prices (base + margin in AVAX).

### Step 2: Connect Wallet
The buyer clicks "Connect Wallet" and connects MetaMask. The app ensures the wallet is on the correct network (Avalanche Fuji Testnet).

### Step 3: Browse & Purchase
The buyer browses available NFTs. Each card shows the total price. Clicking "Buy" initiates a MetaMask transaction for the exact amount. The Showroom contract handles the purchase:
- NFT is transferred directly to the buyer's wallet
- Base price flows to artists via the splitter
- Margin goes to the producer

### Step 4: Verify Ownership
After purchase, the buyer can verify their NFT ownership on Snowtrace or through the Heritage Splitter verification page (`/verify/{contract}/{tokenId}`), which reads on-chain data to confirm ownership and display metadata.
