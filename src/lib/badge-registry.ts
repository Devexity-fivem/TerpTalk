// Badge registry and rarity tokens.
// All badge visual and textual data is centralized here so the database only
// needs to store assignments. No schema changes are required.

export const BADGE_RARITIES = ["common", "rare", "epic", "legendary"] as const
export type BadgeRarity = (typeof BADGE_RARITIES)[number]

export interface BadgeDefinition {
  name: string
  description: string
  requirement: string
  rarity: BadgeRarity
  // Name of the Lucide icon component to render.
  icon: string
}

const r = (rarity: BadgeRarity) => rarity

export const BADGE_REGISTRY: BadgeDefinition[] = [
  // Core participation
  { name: "New Grower", description: "Made your first contribution to the community.", requirement: "Post a thread, reply, or grow diary.", rarity: r("common"), icon: "Sprout" },
  { name: "First Post", description: "Made your first post in the forums.", requirement: "Publish one forum reply or thread.", rarity: r("common"), icon: "PenLine" },
  { name: "First Grow Diary", description: "Started tracking a grow.", requirement: "Create one grow diary.", rarity: r("common"), icon: "BookOpen" },
  { name: "First Setup", description: "Showed off your first grow space.", requirement: "Create one setup showcase.", rarity: r("common"), icon: "Monitor" },
  { name: "First Photo", description: "Shared your first strain or grow photo.", requirement: "Upload one strain/grow photo.", rarity: r("common"), icon: "Camera" },

  // Activity milestones
  { name: "Conversation Starter", description: "Started 5 discussion threads.", requirement: "Create 5 forum threads.", rarity: r("rare"), icon: "MessageSquarePlus" },
  { name: "Active Grower", description: "Made 10 forum posts.", requirement: "Publish 10 replies or threads.", rarity: r("common"), icon: "Flame" },
  { name: "Forum Regular", description: "A reliable voice in the forums.", requirement: "Publish 100 replies or threads.", rarity: r("epic"), icon: "MessageSquare" },
  { name: "10 Posts", description: "Made 10 forum posts.", requirement: "Publish 10 posts.", rarity: r("common"), icon: "MessageSquare" },
  { name: "50 Posts", description: "Made 50 forum posts.", requirement: "Publish 50 posts.", rarity: r("rare"), icon: "MessageSquare" },
  { name: "100 Posts", description: "Made 100 forum posts.", requirement: "Publish 100 posts.", rarity: r("epic"), icon: "MessageSquare" },
  { name: "500 Posts", description: "Made 500 forum posts.", requirement: "Publish 500 posts.", rarity: r("epic"), icon: "MessageSquare" },
  { name: "1,000 Posts", description: "A cornerstone of the community.", requirement: "Publish 1,000 posts.", rarity: r("legendary"), icon: "MessageSquare" },

  // Content / collection
  { name: "Diary Master", description: "Created 5 grow diaries.", requirement: "Create 5 grow diaries.", rarity: r("rare"), icon: "BookOpen" },
  { name: "Garden Veteran", description: "Created 10 grow diaries.", requirement: "Create 10 grow diaries.", rarity: r("epic"), icon: "TreePine" },
  { name: "Grow Diary Keeper", description: "Keeps detailed grow logs.", requirement: "Maintain an active grow diary for 30 days.", rarity: r("rare"), icon: "Calendar" },
  { name: "Strain Hunter", description: "Added 3 strains to the database.", requirement: "Add 3 strains.", rarity: r("rare"), icon: "Search" },
  { name: "Strain Explorer", description: "Helps catalog genetics.", requirement: "Add 10 strains.", rarity: r("rare"), icon: "Binoculars" },
  { name: "Grow Photographer", description: "Shared 5 strain or grow photos.", requirement: "Upload 5 photos.", rarity: r("rare"), icon: "Camera" },
  { name: "Photo Pro", description: "Shared 25 photos.", requirement: "Upload 25 photos.", rarity: r("epic"), icon: "Aperture" },
  { name: "Setup Specialist", description: "A master of grow-space design.", requirement: "Create 5 setup showcases.", rarity: r("rare"), icon: "Monitor" },
  { name: "Content Creator", description: "Contributes high-quality guides or media.", requirement: "Create 5 guides or 10 featured posts.", rarity: r("epic"), icon: "Film" },

  // Social
  { name: "Social Butterfly", description: "Sent 25 messages in community chat.", requirement: "Send 25 chat messages.", rarity: r("rare"), icon: "MessageCircle" },
  { name: "Recruiter", description: "Referred 3 new members.", requirement: "Have 3 users sign up with your referral code.", rarity: r("rare"), icon: "UserPlus" },
  { name: "Community Builder", description: "Brought 10 new members to the community.", requirement: "Have 10 successful referrals.", rarity: r("epic"), icon: "Users" },

  // Recognition
  { name: "Liked", description: "Received 10 likes on your posts and diaries.", requirement: "Earn 10 likes.", rarity: r("common"), icon: "Heart" },
  { name: "Helpful Member", description: "Received 50 likes.", requirement: "Earn 50 likes.", rarity: r("rare"), icon: "ThumbsUp" },
  { name: "Helpful Grower", description: "Received 20 likes on your posts and diaries.", requirement: "Earn 20 likes.", rarity: r("rare"), icon: "Lightbulb" },
  { name: "Community Favorite", description: "Received 100 likes on your posts and diaries.", requirement: "Earn 100 likes.", rarity: r("epic"), icon: "Heart" },
  { name: "Popular Grower", description: "Received 250 likes.", requirement: "Earn 250 likes.", rarity: r("epic"), icon: "Heart" },
  { name: "Helper", description: "Your reply was marked as an accepted answer.", requirement: "Have one reply accepted.", rarity: r("rare"), icon: "CheckCircle" },
  { name: "Top Helper", description: "5 of your replies were marked as accepted answers.", requirement: "Have 5 replies accepted.", rarity: r("epic"), icon: "Award" },
  { name: "Mentor", description: "A trusted source of knowledge.", requirement: "Have 25 replies accepted.", rarity: r("epic"), icon: "GraduationCap" },

  // Reputation tiers
  { name: "Sprout", description: "Reached 250 reputation.", requirement: "Earn 250 reputation.", rarity: r("common"), icon: "Sprout" },
  { name: "Seedling", description: "Reached 750 reputation.", requirement: "Earn 750 reputation.", rarity: r("common"), icon: "Sprout" },
  { name: "Grower", description: "Reached 1,500 reputation.", requirement: "Earn 1,500 reputation.", rarity: r("common"), icon: "Leaf" },
  { name: "Cultivator", description: "Reached 3,500 reputation.", requirement: "Earn 3,500 reputation.", rarity: r("rare"), icon: "Scissors" },
  { name: "Master Grower", description: "Reached 7,000 reputation.", requirement: "Earn 7,000 reputation.", rarity: r("epic"), icon: "Crown" },
  { name: "Legendary Grower", description: "Reached 15,000 reputation.", requirement: "Earn 15,000 reputation.", rarity: r("legendary"), icon: "Gem" },

  // Honours
  { name: "Top Contributor", description: "Reached 10,000 reputation points.", requirement: "Earn 10,000 reputation.", rarity: r("epic"), icon: "TrendingUp" },
  { name: "Dedicated Grower", description: "Posted grow updates 7 days in a row.", requirement: "Update diaries for 7 consecutive days.", rarity: r("epic"), icon: "Flame" },
  { name: "Early Supporter", description: "One of the first to help build TerpTalk.", requirement: "Join during the early-access period.", rarity: r("rare"), icon: "Star" },
  { name: "Beta Tester", description: "Joined TerpTalk during the beta and helped shape the community.", requirement: "Early beta member.", rarity: r("rare"), icon: "Rocket" },
  { name: "Verified YouTuber", description: "A featured cannabis grow content creator on YouTube.", requirement: "Verified by staff as a YouTuber.", rarity: r("epic"), icon: "Video" },
  { name: "Weekly Winner", description: "Won Budshot of the Week.", requirement: "Win a weekly photo contest.", rarity: r("legendary"), icon: "Trophy" },
  { name: "Contest Finalist", description: "Reached the final round of a community contest.", requirement: "Finish top 5 in a contest.", rarity: r("rare"), icon: "Medal" },
  { name: "Contest Winner", description: "Won a community contest.", requirement: "Place first in a contest.", rarity: r("legendary"), icon: "Trophy" },

  // Staff / trust
  { name: "Trusted Member", description: "Recognized by staff as a trusted community member.", requirement: "Awarded by staff.", rarity: r("epic"), icon: "ShieldCheck" },
  { name: "Moderator", description: "Helps keep the community safe.", requirement: "Hold the moderator role.", rarity: r("rare"), icon: "Shield" },
  { name: "Staff", description: "A member of the TerpTalk team.", requirement: "Hold the administrator or staff role.", rarity: r("legendary"), icon: "ShieldCheck" },
]

const BADGE_BY_NAME = new Map(BADGE_REGISTRY.map((b) => [b.name, b]))

export function getBadgeByName(name: string): BadgeDefinition | undefined {
  return BADGE_BY_NAME.get(name)
}

export function getAllBadges(): BadgeDefinition[] {
  return BADGE_REGISTRY
}
