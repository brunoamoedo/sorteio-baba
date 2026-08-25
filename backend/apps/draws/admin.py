from django.contrib import admin

from .models import Draw, Team, TeamPlayer, TeamResult

admin.site.register(Draw)
admin.site.register(Team)
admin.site.register(TeamPlayer)
admin.site.register(TeamResult)
