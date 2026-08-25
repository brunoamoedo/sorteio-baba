from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import Membership, Organization, Plan, User

admin.site.register(User, UserAdmin)
admin.site.register(Plan)
admin.site.register(Organization)
admin.site.register(Membership)
