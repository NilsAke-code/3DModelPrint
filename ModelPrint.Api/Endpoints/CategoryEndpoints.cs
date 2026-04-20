namespace ModelPrint.Api.Endpoints;

public static class CategoryEndpoints
{
    public static readonly string[] AllCategories =
    [
        "Education", "Art", "Gadgets", "Household", "Tools",
        "Toys & Games", "Mechanical", "Miniatures"
    ];

    public static void MapCategoryEndpoints(this WebApplication app)
    {
        app.MapGet("/api/categories", () => Results.Ok(AllCategories));
    }
}
