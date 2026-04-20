namespace ModelPrint.Api.Seed;

/// <summary>
/// Seed model definitions. Titles must match seedModelConfig.ts keys exactly —
/// the browser-side SeedModelBuilder uses the title to look up the GLB/OBJ asset.
/// Only models backed by a real asset in public/seed-assets/ are included.
/// </summary>
public static class SeedData
{
    private static readonly Random Rng = new(42);

    private static readonly string[] Authors =
        ["Alex Rivera", "Sam Chen", "Jordan Lee", "Morgan Taylor", "Casey Novak", "Riley Park", "Quinn Foster"];

    public static List<SeedModel> GetModels() =>
    [
        // ── Art ──
        M("Damaged Helmet",
          "A battle-worn sci-fi helmet with full PBR detail — rust streaks, chipped metallic paint, and a cracked visor. High-resolution textures with normal, roughness, and emissive maps. An iconic showpiece for any collection.",
          "Art", ["Featured", "High Detail"], 6240, 1482),

        M("Medieval Lantern",
          "Hand-crafted iron lantern with decorative metalwork and glass panels. Faithful PBR materials capture the aged iron patina and subtle glass refraction. Perfect for fantasy or historical dioramas.",
          "Art", ["Featured", "Decorative"], 3870, 891),

        M("Glass Vase with Flowers",
          "An elegant glass vase arrangement with detailed flower stems and petals. Transparent glass material with realistic refraction, organic flower forms, and rich color textures. A delicate showpiece.",
          "Art", ["Decorative", "CC0"], 2910, 634),

        // ── Household ──
        M("Designer Chair",
          "Modern lounge chair with velvet upholstery and solid wood legs. Multi-material PBR — soft sheen fabric, warm wood grain, and polished metal caps. A clean, contemporary furniture piece.",
          "Household", ["Featured", "Furniture"], 4115, 967),

        // ── Toys & Games ──
        M("Toy Car",
          "Retro-styled die-cast toy car with painted metal body, stitched fabric seat, and glass windshield. Three distinct PBR materials with realistic aging and reflections. A fun, product-quality display model.",
          "Toys & Games", ["Featured", "CC0"], 5330, 1205),
    ];

    private static SeedModel M(string title, string desc, string category, string[] tags,
        int downloads, int likes) => new()
    {
        Title      = title,
        Description = desc,
        Category   = category,
        Tags       = tags.ToList(),
        AuthorId   = $"seed-{Rng.Next(1, 100)}",
        AuthorName = Authors[Rng.Next(Authors.Length)],
        Downloads  = downloads,
        Likes      = likes,
        CreatedAt  = DateTime.UtcNow.AddDays(-Rng.Next(1, 180)),
    };
}

public class SeedModel
{
    public string Title       { get; set; } = "";
    public string Description { get; set; } = "";
    public string Category    { get; set; } = "";
    public string AuthorId    { get; set; } = "";
    public string AuthorName  { get; set; } = "";
    public int    Downloads   { get; set; }
    public int    Likes       { get; set; }
    public DateTime CreatedAt { get; set; }
    public List<string> Tags  { get; set; } = [];
}
