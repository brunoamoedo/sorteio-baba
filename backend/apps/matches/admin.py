from django.contrib import admin

from .models import Confirmation, Match, RecurringGame

admin.site.register(RecurringGame)
admin.site.register(Match)
admin.site.register(Confirmation)
