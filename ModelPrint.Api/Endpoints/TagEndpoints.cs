using ModelPrint.Api.Repositories;

namespace ModelPrint.Api.Endpoints;

public static class TagEndpoints
{
    public static void MapTagEndpoints(this WebApplication app)
    {
        app.MapGet("/api/tags", async (TagRepository repo) =>
        {
            var tags = await repo.GetAllAsync();
            return Results.Ok(tags);
        });
    }
}
