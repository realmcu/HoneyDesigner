/*
 * Copyright (c) 2026, Realtek Semiconductor Corporation
 *
 * SPDX-License-Identifier: MIT
 */

/**
 * @file lv_cellular.h
 *
 */


#ifndef LV_CELLULAR_H
#define LV_CELLULAR_H

#ifdef __cplusplus
extern "C" {
#endif

/*********************
 *      INCLUDES
 *********************/
#include "../../lv_conf_internal.h"

#if LV_USE_CELLULAR != 0

#include "../../core/lv_obj.h"
#include "../../core/lv_obj_private.h"
#include "../image/lv_image.h"
/*********************
 *      DEFINES
 *********************/

/**********************
 *      TYPEDEFS
 **********************/
// Card container user data structure
typedef struct
{
    int16_t ver_speed;
    int16_t ver_record[5];
    int16_t ver_offset;     //!< Vertical offset.
    int16_t hor_offset;     //!< Horizontal offset.
    int16_t ver_offset_min; //!< Minimum vertical offset.
    int16_t icon_size;
    lv_timer_t *timer;      //!< Timer for inertial motion.
} CellularData;

typedef struct
{
    int16_t start_x;    // Initial X-axis position
    int16_t start_y;    // Initial Y-axis position
} ImgData;

/*Data of cellularate*/
typedef struct {
    lv_obj_t obj;
    CellularData data;
} lv_cellular_t;

LV_ATTRIBUTE_EXTERN_DATA extern const lv_obj_class_t lv_cellular_class;

/**********************
 * GLOBAL PROTOTYPES
 **********************/

/**
 * Create a cellular object
 * @param parent    pointer to an object, it will be the parent of the new cellular
 * @return          pointer to the created bar
 */
lv_obj_t * lv_cellular_create(lv_obj_t * parent);

/**
 * @brief Set the vertical offset of the cellular object.
 *
 * @param cellular pointer to a cellular object
 * @param ver_offset vertical offset
 */
void lv_cellular_set_offset(lv_obj_t *cellular, int32_t ver_offset);

/**
 * Create a cellular layout widget with icons
 *
 * @param parent        Pointer to the parent object (cannot be NULL)
 * @param icon_size     Icon size in pixels
 * @param icon_array    Array of image descriptors for icons
 * @param array_size    Number of icons in the array (must be > 0)
 * @param cb_array      Array of event callback functions for each icon
 * @return              Pointer to the created cellular object
 *
 * @note Layout characteristics:
 * - Icon spacing is automatically calculated
 * - Clicking icons triggers LV_EVENT_SHORT_CLICKED
 */
lv_obj_t *lv_cellular_create_with_icon(lv_obj_t             *parent,
                                        int                   icon_size,
                                        lv_image_dsc_t const *icon_array[],
                                        int                   array_size,
                                        lv_event_cb_t         cb_array[]);

/*======================
 * Add/remove functions
 *=====================*/

/*=====================
 * Setter functions
 *====================*/

/*=====================
 * Getter functions
 *====================*/

/*=====================
 * Other functions
 *====================*/

/**********************
 *      MACROS
 **********************/

#endif /*LV_USE_CELLULAR*/

#ifdef __cplusplus
} /*extern "C"*/
#endif

#endif /*LV_CELLULAR_H*/
