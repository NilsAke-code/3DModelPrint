using System.Text.Json.Serialization;

namespace ModelPrint.Api.Models;

public class User
{
    public int Id { get; set; }
    public string Email { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string MicrosoftId { get; set; } = "";
    public int Role { get; set; } = 1;
    public string? ProfilePicturePath { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime LastLoginAt { get; set; }

    [JsonIgnore]
    public ICollection<DownloadHistory> DownloadHistories { get; set; } = [];
}

public class DownloadHistory
{
    public int Id { get; set; }
    public int ModelId { get; set; }
    public int UserId { get; set; }
    public DateTime DownloadedAt { get; set; }

    [JsonIgnore]
    public Model3D? Model { get; set; }
    [JsonIgnore]
    public User? UserNav { get; set; }
}

public class UserResponse
{
    public int Id { get; set; }
    public string Email { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public int Role { get; set; }
    public string? ProfilePictureUrl { get; set; }
}

public class UpdateProfileRequest
{
    public string DisplayName { get; set; } = "";
}

public class AdminStats
{
    public int TotalModels { get; set; }
    public int TotalUsers { get; set; }
    public int TotalDownloads { get; set; }
    public int TotalLikes { get; set; }
    public int ModelsLast7Days { get; set; }
    public int ModelsLast30Days { get; set; }
    public int UsersLast7Days { get; set; }
    public int UsersLast30Days { get; set; }
}

public class UpdateRoleRequest
{
    public int Role { get; set; }
}
